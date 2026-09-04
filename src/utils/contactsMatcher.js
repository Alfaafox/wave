import * as Contacts from 'expo-contacts';
import * as Crypto from 'expo-crypto';
import { normalizePhone } from './normalizePhone';
import { matchContacts } from './api';

/**
 * Reads the device contact list, hashes each phone number, and asks the
 * backend which ones belong to registered Wave users. Raw numbers never
 * leave the device — only SHA-256 hashes are sent.
 *
 * Returns: { registered: [{ id, name, phone, contactName, profilePicture }], unregistered: [{ contactName, phone }] }
 */
export async function getMatchedContacts(token) {
  const { status } = await Contacts.requestPermissionsAsync();
  if (status !== 'granted') {
    const err = new Error('Contacts permission was not granted.');
    err.code = 'PERMISSION_DENIED';
    throw err;
  }

  const { data } = await Contacts.getContactsAsync({
    fields: [Contacts.Fields.PhoneNumbers]
  });

  const seenNormalized = new Set();
  const hashToContact = {};
  const hashesToCheck = [];

  for (const contact of data) {
    if (!contact.phoneNumbers || contact.phoneNumbers.length === 0) continue;
    const rawNumber = contact.phoneNumbers[0].number;
    const normalized = normalizePhone(rawNumber);
    if (!normalized || seenNormalized.has(normalized)) continue;
    seenNormalized.add(normalized);

    const hash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      normalized,
      { encoding: Crypto.CryptoEncoding.HEX }
    );

    hashToContact[hash] = {
      contactName: contact.name || rawNumber,
      phone: rawNumber
    };
    hashesToCheck.push(hash);
  }

  if (hashesToCheck.length === 0) {
    return { registered: [], unregistered: [] };
  }

  const { matches } = await matchContacts(token, hashesToCheck);

  const matchedHashes = new Set(matches.map((m) => m.hash));

  const registered = matches.map((m) => ({
    id: m.id,
    name: m.name,
    phone: m.phone, // authoritative — the matched user's own registered number
    contactName: hashToContact[m.hash]?.contactName || m.name,
    profilePicture: m.profilePicture
  }));

  const unregistered = Object.entries(hashToContact)
    .filter(([hash]) => !matchedHashes.has(hash))
    .map(([, contact]) => contact);

  return { registered, unregistered };
}
