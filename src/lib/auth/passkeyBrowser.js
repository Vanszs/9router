/**
 * Client-side WebAuthn helpers using @simplewebauthn/browser.
 * Dynamically imported to avoid loading the library on pages that don't use it.
 */
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";

export { startAuthentication, startRegistration };
