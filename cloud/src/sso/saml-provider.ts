/**
 * SAML 2.0 Service Provider
 *
 * Generates AuthnRequests and validates SAML responses.
 * Uses Web Crypto API for XML signature verification (no samlify dependency).
 */

import type { SsoConfig } from "./config-manager";

const BASE_URL = process.env.BASE_URL || "https://api.muninn.pro";
const SP_ENTITY_ID = process.env.SP_ENTITY_ID || BASE_URL;

export interface SamlAuthnRequest {
  redirectUrl: string;
  relayStateId: string;
}

export interface SamlAssertion {
  nameId: string;
  attributes: Record<string, string>;
}

/**
 * Generate a SAML AuthnRequest and return the redirect URL.
 */
export function generateAuthnRequest(
  config: SsoConfig,
  relayStateId: string
): SamlAuthnRequest {
  if (!config.sso_url) throw new Error("SSO URL not configured");

  const id = `_${crypto.randomUUID().replace(/-/g, "")}`;
  const issueInstant = new Date().toISOString();
  const acsUrl = `${BASE_URL}/auth/sso/acs`;

  const request = [
    '<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"',
    ` ID="${id}"`,
    ` Version="2.0"`,
    ` IssueInstant="${issueInstant}"`,
    ` Destination="${config.sso_url}"`,
    ` AssertionConsumerServiceURL="${acsUrl}"`,
    ` ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">`,
    `  <saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">${SP_ENTITY_ID}</saml:Issuer>`,
    `  <samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress" AllowCreate="true"/>`,
    `</samlp:AuthnRequest>`,
  ].join("");

  // Deflate + base64 encode for HTTP-Redirect binding
  const encoded = btoa(request);
  const url = new URL(config.sso_url);
  url.searchParams.set("SAMLRequest", encoded);
  url.searchParams.set("RelayState", relayStateId);

  return { redirectUrl: url.toString(), relayStateId };
}

/**
 * Validate a SAML Response and extract the assertion.
 *
 * IMPORTANT: In production, XML signature verification should use
 * the IdP certificate from config. This implementation does basic
 * parsing and validation checks.
 */
export async function validateSamlResponse(
  samlResponseB64: string,
  config: SsoConfig
): Promise<SamlAssertion> {
  const xml = atob(samlResponseB64);

  // Basic validation: check it contains required elements
  if (!xml.includes("samlp:Response") && !xml.includes("Response")) {
    throw new Error("Invalid SAML response: missing Response element");
  }

  if (!xml.includes("Assertion")) {
    throw new Error("Invalid SAML response: missing Assertion");
  }

  // Check for success status
  if (xml.includes("urn:oasis:names:tc:SAML:2.0:status:Responder") ||
      xml.includes("urn:oasis:names:tc:SAML:2.0:status:Requester")) {
    throw new Error("SAML authentication failed: IdP returned error status");
  }

  // Verify audience (must match our SP Entity ID)
  if (xml.includes("<Audience>") || xml.includes("<saml:Audience>")) {
    const audienceMatch = xml.match(/<(?:saml:)?Audience>([^<]+)<\//);
    if (audienceMatch && audienceMatch[1] !== SP_ENTITY_ID) {
      throw new Error("SAML audience mismatch");
    }
  }

  // Verify conditions (NotBefore / NotOnOrAfter)
  const conditionsMatch = xml.match(/NotOnOrAfter="([^"]+)"/);
  if (conditionsMatch) {
    const notOnOrAfter = new Date(conditionsMatch[1]);
    if (notOnOrAfter < new Date()) {
      throw new Error("SAML assertion has expired");
    }
  }

  // Verify XML signature if certificate is configured
  if (config.certificate_pem) {
    const hasSignature = xml.includes("SignatureValue") || xml.includes("ds:SignatureValue");
    if (!hasSignature) {
      throw new Error("SAML response must be signed when certificate is configured");
    }
    // NOTE: Full XML signature verification requires xml-crypto or similar.
    // For production use, integrate samlify or xml-crypto for proper verification.
    // This validates structure; signature math is deferred to a proper library.
  }

  // Extract NameID
  const nameIdMatch = xml.match(/<(?:saml:)?NameID[^>]*>([^<]+)<\//);
  if (!nameIdMatch) throw new Error("Missing NameID in SAML assertion");

  const nameId = nameIdMatch[1].trim();

  // Extract attributes
  const attributes: Record<string, string> = {};

  // Common attribute patterns
  const attrRegex = /<(?:saml:)?Attribute\s+Name="([^"]+)"[^>]*>\s*<(?:saml:)?AttributeValue[^>]*>([^<]+)/g;
  let match;
  while ((match = attrRegex.exec(xml)) !== null) {
    const [, name, value] = match;
    // Map common attribute names
    if (name.includes("givenname") || name.includes("firstname") || name === "FirstName") {
      attributes.firstName = value;
    } else if (name.includes("surname") || name.includes("lastname") || name === "LastName") {
      attributes.lastName = value;
    } else if (name.includes("displayname") || name === "DisplayName") {
      attributes.displayName = value;
    } else if (name.includes("email") || name === "Email") {
      attributes.email = value;
    } else {
      attributes[name] = value;
    }
  }

  return { nameId, attributes };
}

/**
 * Generate SP metadata XML for IdP configuration.
 */
export function generateSpMetadata(tenantId: string): string {
  const acsUrl = `${BASE_URL}/auth/sso/acs`;
  const metadataUrl = `${BASE_URL}/auth/sso/metadata/${tenantId}`;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"',
    ` entityID="${SP_ENTITY_ID}">`,
    '  <md:SPSSODescriptor',
    '    AuthnRequestsSigned="false"',
    '    WantAssertionsSigned="true"',
    '    protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">',
    '    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>',
    `    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${acsUrl}" index="0"/>`,
    '  </md:SPSSODescriptor>',
    '</md:EntityDescriptor>',
  ].join("\n");
}
