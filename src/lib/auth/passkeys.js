import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { getPasskeys, getPasskeyById, createPasskey, updatePasskeyCounter, deletePasskey } from "@/lib/db/repos/passkeysRepo.js";
import { getSettings, updateSettings } from "@/lib/db/repos/settingsRepo.js";
import { getPublicOrigin } from "@/lib/auth/oidc.js";

/**
 * Determine the Relying Party (RP) configuration from the request origin.
 * WebAuthn requires the RP ID to match the domain the browser is on.
 */
function getRpConfig(request) {
  const origin = getPublicOrigin(request);
  let rpId;
  try {
    rpId = new URL(origin).hostname;
  } catch {
    // Fallback: use the Host header
    rpId = (request.headers.get("host") || "localhost").split(":")[0];
  }
  // For localhost, WebAuthn requires rpId to be "localhost"
  if (rpId === "127.0.0.1" || rpId === "::1") rpId = "localhost";
  return { rpId, origin };
}

/**
 * Generate registration options for a new passkey.
 * Called when the user wants to register a passkey from the profile page.
 */
export async function startPasskeyRegistration(request) {
  const { rpId } = getRpConfig(request);

  const existingPasskeys = await getPasskeys();
  const excludedCredentials = existingPasskeys.map((pk) => ({
    id: pk.id,
    type: "public-key",
    transports: pk.transports,
  }));

  const options = await generateRegistrationOptions({
    rpName: "VansRouter",
    rpID: rpId,
    userName: "VansRouter Admin",
    userDisplayName: "VansRouter Dashboard",
    excludeCredentials: excludedCredentials,
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  return options;
}

/**
 * Verify the registration response and store the new passkey.
 */
export async function finishPasskeyRegistration(request, credential, nickname) {
  const { rpId, origin } = getRpConfig(request);
  const expectedChallenge = credential.challenge;

  const verification = await verifyRegistrationResponse({
    response: credential,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpId,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("Registration verification failed");
  }

  const { credential: cred } = verification.registrationInfo;
  await createPasskey({
    id: cred.id,
    publicKey: Buffer.from(cred.publicKey).toString("base64url"),
    counter: cred.counter,
    transports: cred.transports || [],
    deviceType: verification.registrationInfo.credentialDeviceType || "singleDevice",
    nickname: nickname || null,
  });

  // Auto-enable passkeys when the first one is registered
  const count = (await getPasskeys()).length;
  if (count > 0) {
    const settings = await getSettings();
    if (!settings.passkeysEnabled) {
      await updateSettings({ passkeysEnabled: true });
    }
  }

  return { verified: true, id: cred.id };
}

/**
 * Generate authentication options for passkey login.
 */
export async function startPasskeyLogin(request) {
  const { rpId } = getRpConfig(request);

  const passkeys = await getPasskeys();
  const allowCredentials = passkeys.map((pk) => ({
    id: pk.id,
    type: "public-key",
    transports: pk.transports,
  }));

  const options = await generateAuthenticationOptions({
    rpID: rpId,
    allowCredentials,
    userVerification: "preferred",
  });

  return options;
}

/**
 * Verify the authentication response and return success if valid.
 */
export async function finishPasskeyLogin(request, assertion) {
  const { rpId, origin } = getRpConfig(request);
  const expectedChallenge = assertion.challenge;

  const passkeys = await getPasskeys();
  if (passkeys.length === 0) {
    throw new Error("No passkeys registered");
  }

  // Find the passkey matching the credential ID in the assertion
  const credId = assertion.id;
  const passkey = passkeys.find((pk) => pk.id === credId);
  if (!passkey) {
    throw new Error("Passkey not found");
  }

  const verification = await verifyAuthenticationResponse({
    response: assertion,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpId,
    credential: {
      id: passkey.id,
      publicKey: Buffer.from(passkey.publicKey, "base64url"),
      counter: passkey.counter,
      transports: passkey.transports,
    },
  });

  if (!verification.verified) {
    throw new Error("Authentication verification failed");
  }

  // Update the counter for replay protection
  await updatePasskeyCounter(passkey.id, verification.authenticationInfo.newCounter);

  return { verified: true, passkeyId: passkey.id };
}

/**
 * List all registered passkeys (for the profile management UI).
 */
export async function listPasskeys() {
  return await getPasskeys();
}

/**
 * Remove a passkey by ID.
 */
export async function removePasskey(id) {
  await deletePasskey(id);
  // Auto-disable passkeys when the last one is removed
  const count = (await getPasskeys()).length;
  if (count === 0) {
    await updateSettings({ passkeysEnabled: false, remoteAuthMode: "password" });
  }
}
