// Builds the custom SorobanAuthorizationEntry our AgentAccount smart account
// expects: a `Self::Signature = AuthPayload { signers, context_rule_ids }`,
// XDR-encoded as a named-struct ScVal::Map, per OpenZeppelin's smart-account
// wire format (packages/accounts/README.md, "AuthPayload struct").
//
// Two identities use this account: the AI agent (External signer bound to
// the CallContract(token) rule) and the human admin (External signer bound
// to the CallContract(mandate_policy) rule). Either way, authorization
// requires a REAL signature over the auth digest OpenZeppelin defines:
//   auth_digest = sha256(signature_payload || context_rule_ids.to_xdr())
// where `signature_payload` is the standard Soroban authorization preimage
// hash (network id + nonce + expiration + invocation tree).
import { Address, xdr, nativeToScVal, buildAuthorizationEntryPreimage, hash } from "@stellar/stellar-sdk";

function contextRuleIdsScVal(contextRuleId) {
  return xdr.ScVal.scvVec([xdr.ScVal.scvU32(contextRuleId)]);
}

function authPayloadScVal(contextRuleId, signersMapScVal) {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("context_rule_ids"),
      val: contextRuleIdsScVal(contextRuleId),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("signers"),
      val: signersMapScVal,
    }),
  ]);
}

function randomNonce() {
  const hi = BigInt(Math.floor(Math.random() * 0x7fffffff));
  const lo = BigInt(Math.floor(Math.random() * 0xffffffff));
  return (hi << 32n) | lo;
}

function signerKeyScVal(verifierId, pubkeyBytes) {
  // `Signer::External(Address, Bytes)` — soroban_sdk enum tuple-variants
  // encode as ScVal::Vec([Symbol(variant), ...fields]).
  return xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("External"),
    new Address(verifierId).toScVal(),
    xdr.ScVal.scvBytes(Buffer.from(pubkeyBytes)),
  ]);
}

/**
 * Builds the SorobanAuthorizationEntry that authorizes `smartAccountId` to
 * invoke `functionName(...args)` on `targetContractId`, under context rule
 * `contextRuleId`, REALLY signed by `signerKeypair`'s Ed25519 key. This is
 * the general form — used for the agent's transfers AND the admin's
 * `update_mandate` calls, just pointed at different contracts/rules/keys.
 */
function buildSignedAuthEntry({
  smartAccountId,
  targetContractId,
  functionName,
  args,
  contextRuleId,
  signatureExpirationLedger,
  verifierId,
  signerKeypair, // stellar-sdk Keypair — .rawPublicKey() / .sign() used
  networkPassphrase,
}) {
  const invokeArgs = new xdr.InvokeContractArgs({
    contractAddress: new Address(targetContractId).toScAddress(),
    functionName,
    args,
  });

  const rootInvocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invokeArgs),
    subInvocations: [],
  });

  const nonce = randomNonce();

  // Step 1: build the entry with a placeholder signature, just to compute
  // the standard Soroban authorization preimage/hash over it.
  const placeholderCredentials = xdr.SorobanCredentials.sorobanCredentialsAddress(
    new xdr.SorobanAddressCredentials({
      address: new Address(smartAccountId).toScAddress(),
      nonce,
      signatureExpirationLedger,
      signature: xdr.ScVal.scvVoid(),
    })
  );
  const placeholderEntry = new xdr.SorobanAuthorizationEntry({
    credentials: placeholderCredentials,
    rootInvocation,
  });

  const preimage = buildAuthorizationEntryPreimage(
    placeholderEntry,
    signatureExpirationLedger,
    networkPassphrase
  );
  const signaturePayload = hash(preimage.toXDR());

  // Step 2: auth_digest = sha256(signature_payload || context_rule_ids.to_xdr())
  const contextRuleIdsXdrBytes = contextRuleIdsScVal(contextRuleId).toXDR();
  const authDigest = hash(Buffer.concat([Buffer.from(signaturePayload), Buffer.from(contextRuleIdsXdrBytes)]));

  // Step 3: the signer actually signs the digest with its real Ed25519 key.
  const signature = signerKeypair.sign(Buffer.from(authDigest));

  const pubkeyBytes = signerKeypair.rawPublicKey();
  const signersMap = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: signerKeyScVal(verifierId, pubkeyBytes),
      val: xdr.ScVal.scvBytes(Buffer.from(signature)),
    }),
  ]);

  const finalCredentials = xdr.SorobanCredentials.sorobanCredentialsAddress(
    new xdr.SorobanAddressCredentials({
      address: new Address(smartAccountId).toScAddress(),
      nonce,
      signatureExpirationLedger,
      signature: authPayloadScVal(contextRuleId, signersMap),
    })
  );

  return new xdr.SorobanAuthorizationEntry({ credentials: finalCredentials, rootInvocation });
}

/**
 * Thin wrapper: authorizes `transfer(smartAccountId, toId, amount)` on
 * `tokenId`, signed by the agent's key. Kept for callers that only deal in
 * transfers.
 */
function buildSignedTransferAuthEntry({
  smartAccountId,
  tokenId,
  toId,
  amount,
  contextRuleId,
  signatureExpirationLedger,
  verifierId,
  agentKeypair,
  networkPassphrase,
}) {
  return buildSignedAuthEntry({
    smartAccountId,
    targetContractId: tokenId,
    functionName: "transfer",
    args: [
      new Address(smartAccountId).toScVal(),
      new Address(toId).toScVal(),
      nativeToScVal(amount, { type: "i128" }),
    ],
    contextRuleId,
    signatureExpirationLedger,
    verifierId,
    signerKeypair: agentKeypair,
    networkPassphrase,
  });
}

export { buildSignedAuthEntry, buildSignedTransferAuthEntry };
