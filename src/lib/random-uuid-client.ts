/**
 * UUID v4 for the browser without requiring a secure context.
 * `crypto.randomUUID()` is undefined on plain HTTP tabs (e.g. in-cluster Puppeteer /
 * ClusterIP URLs); `crypto.getRandomValues` is still available there.
 */
export function randomUuidV4(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
		throw new Error('crypto.getRandomValues is not available — need HTTPS or a modern browser');
	}
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	let hex = '';
	for (let i = 0; i < bytes.length; i++) {
		hex += bytes[i].toString(16).padStart(2, '0');
	}
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
