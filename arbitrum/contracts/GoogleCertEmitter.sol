// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

interface IWormholeCore {
    /// See Wormhole Implementation.sol
    /// returns sequence number
    function publishMessage(
        uint32 nonce,
        bytes memory payload,
        uint8 consistencyLevel
    ) external payable returns (uint64 sequence);

    /// Get the current message fee
    function messageFee() external view returns (uint256);
}

contract GoogleCertEmitter {
    IWormholeCore public immutable wormhole;
    address public owner;

    event SnapshotPublished(uint64 sequence, uint32 nonce, uint8 consistencyLevel);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor(address _wormholeCore) {
        wormhole = IWormholeCore(_wormholeCore);
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    /// @notice Transfer ownership to a new address
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "invalid new owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Get the required message fee from Wormhole
    function getMessageFee() external view returns (uint256) {
        return wormhole.messageFee();
    }

    /// @notice POC: payload is raw JSON or any encoded struct with the Google certs
    /// @param payload The raw bytes of the Google cert JSON snapshot
    /// @return sequence The Wormhole sequence number for this message
    function publishGoogleSnapshot(bytes calldata payload)
        external
        payable
        onlyOwner
        returns (uint64 sequence)
    {
        // Use block timestamp as nonce for uniqueness
        uint32 nonce = uint32(block.timestamp);
        // consistencyLevel: 1 = "confirmed", typical for EVM chains
        uint8 consistencyLevel = 1;

        // Wormhole core requires msg.value >= messageFee
        sequence = wormhole.publishMessage{value: msg.value}(
            nonce,
            payload,
            consistencyLevel
        );

        emit SnapshotPublished(sequence, nonce, consistencyLevel);
    }

    /// @notice Withdraw any ETH stuck in contract
    function withdraw() external onlyOwner {
        payable(owner).transfer(address(this).balance);
    }

    receive() external payable {}
}
