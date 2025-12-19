// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {FunctionsClient} from "@chainlink/contracts/src/v0.8/functions/v1_0_0/FunctionsClient.sol";
import {ConfirmedOwner} from "@chainlink/contracts/src/v0.8/shared/access/ConfirmedOwner.sol";
import {FunctionsRequest} from "@chainlink/contracts/src/v0.8/functions/v1_0_0/libraries/FunctionsRequest.sol";
import {AutomationCompatibleInterface} from "@chainlink/contracts/src/v0.8/automation/AutomationCompatible.sol";

interface IWormholeCore {
    function publishMessage(
        uint32 nonce,
        bytes memory payload,
        uint8 consistencyLevel
    ) external payable returns (uint64 sequence);

    function messageFee() external view returns (uint256);
}

/**
 * @title GoogleCertFunctionsConsumer
 * @notice Chainlink Functions consumer that fetches Google X.509 certificates,
 *         extracts RSA public keys, and publishes to Wormhole for NEAR bridge.
 *         Uses Chainlink Automation to fetch data every hour automatically.
 */
contract GoogleCertFunctionsConsumer is FunctionsClient, ConfirmedOwner, AutomationCompatibleInterface {
    using FunctionsRequest for FunctionsRequest.Request;

    // Chainlink Functions configuration
    bytes32 public s_lastRequestId;
    bytes public s_lastResponse;
    bytes public s_lastError;
    uint64 public subscriptionId;
    bytes32 public donId;
    uint32 public gasLimit = 300000;

    // Chainlink Automation configuration
    uint256 public updateInterval = 5 minutes; // Default: fetch every 5 minutes (for testing)
    uint256 public lastAutomationTimestamp;
    bool public automationEnabled = true;

    // Wormhole configuration
    IWormholeCore public immutable wormhole;
    
    // Latest certificate data
    bytes public latestCertPayload;
    uint256 public lastUpdateTimestamp;
    uint64 public lastWormholeSequence;

    // JavaScript source code for Chainlink Functions
    string public source;

    // Events (RequestSent is inherited from FunctionsClient)
    event CertificatesUpdated(bytes32 indexed requestId, uint256 payloadSize);
    event SnapshotPublished(uint64 indexed sequence, uint256 payloadSize);
    event AutomationTriggered(bytes32 indexed requestId, uint256 timestamp);

    // Errors
    error UnexpectedRequestID(bytes32 requestId);
    error InsufficientWormholeFee();

    constructor(
        address router,
        address wormholeCore,
        bytes32 _donId,
        uint64 _subscriptionId
    ) FunctionsClient(router) ConfirmedOwner(msg.sender) {
        wormhole = IWormholeCore(wormholeCore);
        donId = _donId;
        subscriptionId = _subscriptionId;
    }

    /**
     * @notice Set the JavaScript source code for fetching Google certs
     * @param _source The JavaScript source code
     */
    function setSource(string calldata _source) external onlyOwner {
        source = _source;
    }

    /**
     * @notice Update the DON ID
     */
    function setDonId(bytes32 _donId) external onlyOwner {
        donId = _donId;
    }

    /**
     * @notice Update the subscription ID
     */
    function setSubscriptionId(uint64 _subscriptionId) external onlyOwner {
        subscriptionId = _subscriptionId;
    }

    /**
     * @notice Update the gas limit for callback
     */
    function setGasLimit(uint32 _gasLimit) external onlyOwner {
        gasLimit = _gasLimit;
    }

    /**
     * @notice Set the automation update interval
     * @param _interval The new interval in seconds (default: 3600 = 1 hour)
     */
    function setUpdateInterval(uint256 _interval) external onlyOwner {
        updateInterval = _interval;
    }

    /**
     * @notice Enable or disable automation
     * @param _enabled Whether automation should be enabled
     */
    function setAutomationEnabled(bool _enabled) external onlyOwner {
        automationEnabled = _enabled;
    }

    // ============ Chainlink Automation Functions ============

    /**
     * @notice Chainlink Automation check function
     * @dev Called by Chainlink Automation nodes to check if upkeep is needed
     * @return upkeepNeeded Whether upkeep should be performed
     * @return performData Data to pass to performUpkeep (empty in this case)
     */
    function checkUpkeep(
        bytes calldata /* checkData */
    ) external view override returns (bool upkeepNeeded, bytes memory performData) {
        upkeepNeeded = automationEnabled && 
                       bytes(source).length > 0 && 
                       (block.timestamp - lastAutomationTimestamp) >= updateInterval;
        performData = "";
    }

    /**
     * @notice Chainlink Automation perform function
     * @dev Called by Chainlink Automation when checkUpkeep returns true
     */
    function performUpkeep(bytes calldata /* performData */) external override {
        // Re-validate the conditions to prevent unauthorized calls
        if (!automationEnabled) {
            return;
        }
        if (bytes(source).length == 0) {
            return;
        }
        if ((block.timestamp - lastAutomationTimestamp) < updateInterval) {
            return;
        }

        // Update timestamp before making the request
        lastAutomationTimestamp = block.timestamp;

        // Make the Chainlink Functions request
        FunctionsRequest.Request memory req;
        req.initializeRequestForInlineJavaScript(source);

        s_lastRequestId = _sendRequest(
            req.encodeCBOR(),
            subscriptionId,
            gasLimit,
            donId
        );

        emit AutomationTriggered(s_lastRequestId, block.timestamp);
        emit RequestSent(s_lastRequestId);
    }

    // ============ Manual Request Functions ============

    /**
     * @notice Request fresh Google certificates via Chainlink Functions
     * @return requestId The Chainlink Functions request ID
     */
    function requestCertificates() external onlyOwner returns (bytes32 requestId) {
        FunctionsRequest.Request memory req;
        req.initializeRequestForInlineJavaScript(source);

        s_lastRequestId = _sendRequest(
            req.encodeCBOR(),
            subscriptionId,
            gasLimit,
            donId
        );

        emit RequestSent(s_lastRequestId);
        return s_lastRequestId;
    }

    /**
     * @notice Callback function for Chainlink Functions
     */
    function fulfillRequest(
        bytes32 requestId,
        bytes memory response,
        bytes memory err
    ) internal override {
        if (s_lastRequestId != requestId) {
            revert UnexpectedRequestID(requestId);
        }

        s_lastError = err;

        // If we got a valid response, update the certificate payload
        // Skip storing in s_lastResponse to save gas - use latestCertPayload instead
        if (response.length > 0 && err.length == 0) {
            latestCertPayload = response;
            lastUpdateTimestamp = block.timestamp;
            emit CertificatesUpdated(requestId, response.length);
        }
    }

    /**
     * @notice Publish the latest certificate data to Wormhole
     * @dev Anyone can call this once data is available, but they must pay the fee
     * @return sequence The Wormhole sequence number
     */
    function publishToWormhole() external payable returns (uint64 sequence) {
        require(latestCertPayload.length > 0, "No certificate data available");
        
        uint256 fee = wormhole.messageFee();
        if (msg.value < fee) {
            revert InsufficientWormholeFee();
        }

        uint32 nonce = uint32(block.timestamp);
        uint8 consistencyLevel = 1; // confirmed

        sequence = wormhole.publishMessage{value: fee}(
            nonce,
            latestCertPayload,
            consistencyLevel
        );

        lastWormholeSequence = sequence;

        emit SnapshotPublished(sequence, latestCertPayload.length);

        // Refund excess ETH
        if (msg.value > fee) {
            payable(msg.sender).transfer(msg.value - fee);
        }
    }

    /**
     * @notice Request certificates AND publish to Wormhole in one transaction
     * @dev Useful for automation - the Wormhole publish happens in callback
     */
    function requestAndPublish() external payable onlyOwner returns (bytes32 requestId) {
        // First request fresh data
        FunctionsRequest.Request memory req;
        req.initializeRequestForInlineJavaScript(source);

        requestId = _sendRequest(
            req.encodeCBOR(),
            subscriptionId,
            gasLimit,
            donId
        );

        s_lastRequestId = requestId;
        emit RequestSent(requestId);

        // Note: The actual publish must happen after fulfillRequest callback
        // Use publishToWormhole() after the callback completes
    }

    /**
     * @notice Get the Wormhole message fee
     */
    function getWormholeFee() external view returns (uint256) {
        return wormhole.messageFee();
    }

    /**
     * @notice Get the latest certificate payload
     */
    function getLatestPayload() external view returns (bytes memory, uint256 timestamp) {
        return (latestCertPayload, lastUpdateTimestamp);
    }

    /**
     * @notice Get automation status information
     * @return enabled Whether automation is enabled
     * @return interval The update interval in seconds
     * @return lastUpdate The timestamp of the last automation update
     * @return nextUpdate The timestamp when the next update will be allowed
     */
    function getAutomationStatus() external view returns (
        bool enabled,
        uint256 interval,
        uint256 lastUpdate,
        uint256 nextUpdate
    ) {
        enabled = automationEnabled;
        interval = updateInterval;
        lastUpdate = lastAutomationTimestamp;
        nextUpdate = lastAutomationTimestamp + updateInterval;
    }

    /**
     * @notice Withdraw any ETH stuck in contract
     */
    function withdraw() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    receive() external payable {}
}
