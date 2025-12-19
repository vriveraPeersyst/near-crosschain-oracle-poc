/**
 * Chainlink Functions Source: Google RSA Public Key Extractor
 *
 * Fetches Google's X.509 certificates and extracts RSA public keys (n, e)
 * for on-chain JWT verification via Wormhole bridge to NEAR.
 *
 * Returns: Encoded RSA modulus (n) bytes for the first certificate
 */

// =====================
// 1) PEM -> DER bytes
// =====================
function pemToDer(pem) {
  const base64 = pem
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// =====================
// 2) Minimal ASN.1 DER parser (TLV)
// =====================
function readLength(bytes, offset) {
  const lenByte = bytes[offset];
  if (lenByte < 0x80) {
    return { length: lenByte, lengthBytes: 1 };
  }
  const numBytes = lenByte & 0x7f;
  let length = 0;
  for (let i = 0; i < numBytes; i++) {
    length = (length << 8) | bytes[offset + 1 + i];
  }
  return { length, lengthBytes: 1 + numBytes };
}

function parseAsn1(bytes, offset = 0) {
  const start = offset;
  const tag = bytes[offset++];

  const { length, lengthBytes } = readLength(bytes, offset);
  offset += lengthBytes;

  const end = offset + length;
  const constructed = (tag & 0x20) !== 0;
  const tagNumber = tag & 0x1f;
  const tagClass = tag >> 6;

  const node = {
    tag,
    tagClass,
    tagNumber,
    constructed,
    start,
    end,
    length,
    value: bytes.subarray(offset, end),
    sub: [],
  };

  if (constructed) {
    let childOffset = offset;
    while (childOffset < end) {
      const child = parseAsn1(bytes, childOffset);
      node.sub.push(child);
      childOffset = child.end;
    }
  }

  return node;
}

// =====================
// 3) Helpers: INTEGER cleanup + hex conversions
// =====================
function stripIntegerPadding(intBytes) {
  let i = 0;
  while (i < intBytes.length - 1 && intBytes[i] === 0x00) i++;
  return intBytes.subarray(i);
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// =====================
// 4) Walk X.509 -> SubjectPublicKeyInfo
// =====================
function getSubjectPublicKeyInfoNode(certDer) {
  const certNode = parseAsn1(certDer);
  if (!certNode.constructed || certNode.sub.length < 1) {
    throw new Error("Invalid certificate: not a SEQUENCE or missing children");
  }

  const tbs = certNode.sub[0];
  if (!tbs.constructed) {
    throw new Error("Invalid certificate: TBSCertificate not constructed");
  }

  let idx = 0;

  // version is OPTIONAL and encoded as [0] EXPLICIT (context-specific tag 0)
  if (tbs.sub[idx] && tbs.sub[idx].tagClass === 2 && tbs.sub[idx].tagNumber === 0) {
    idx++;
  }

  // SPKI is at idx + 5: serialNumber, signature, issuer, validity, subject, subjectPublicKeyInfo
  const spki = tbs.sub[idx + 5];
  if (!spki) throw new Error("Invalid certificate: SubjectPublicKeyInfo not found");
  return spki;
}

// =====================
// 5) Extract PKCS#1 RSAPublicKey from SPKI BIT STRING
// =====================
function extractRsaNEFromSpki(spkiNode) {
  if (!spkiNode.constructed || spkiNode.sub.length < 2) {
    throw new Error("Invalid SPKI: expected SEQUENCE with 2 children");
  }

  const bitStringNode = spkiNode.sub[1];
  const bitString = bitStringNode.value;
  if (!bitString || bitString.length < 2) {
    throw new Error("Invalid BIT STRING in SPKI");
  }

  // The remaining bytes are DER of RSAPublicKey
  const rsaDer = bitString.subarray(1);
  const rsaNode = parseAsn1(rsaDer);

  if (!rsaNode.constructed || rsaNode.sub.length < 2) {
    throw new Error("Invalid RSAPublicKey: expected SEQUENCE(modulus, exponent)");
  }

  const modulusNode = rsaNode.sub[0];
  const exponentNode = rsaNode.sub[1];

  if (modulusNode.tagClass !== 0 || modulusNode.tagNumber !== 2) {
    throw new Error("Invalid RSAPublicKey: modulus is not INTEGER");
  }
  if (exponentNode.tagClass !== 0 || exponentNode.tagNumber !== 2) {
    throw new Error("Invalid RSAPublicKey: exponent is not INTEGER");
  }

  const nBytes = stripIntegerPadding(modulusNode.value);
  const eBytes = stripIntegerPadding(exponentNode.value);

  return {
    nBytes,
    eBytes,
    nHex: bytesToHex(nBytes),
    eHex: bytesToHex(eBytes),
  };
}

// =====================
// 6) High-level: PEM -> {n,e}
// =====================
function getRsaPublicKeyNEFromCertificatePem(pem) {
  const der = pemToDer(pem);
  const spki = getSubjectPublicKeyInfoNode(der);
  return extractRsaNEFromSpki(spki);
}

// =====================
// 7) Main: Fetch certs and extract RSA keys
// =====================
const certificateRequest = Functions.makeHttpRequest({
  url: "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com",
});

const certificateResponse = await certificateRequest;
if (certificateResponse.error) {
  throw Error(`Request failed: ${certificateResponse.error}`);
}

const data = certificateResponse["data"];
const kids = Object.keys(data);

if (kids.length === 0) {
  throw Error("No certificates found");
}

// Extract RSA key from the first certificate only
const kid = kids[0];
const cert = data[kid];
const { nBytes } = getRsaPublicKeyNEFromCertificatePem(cert);

// Return raw 256 bytes of the modulus (n)
return nBytes;
