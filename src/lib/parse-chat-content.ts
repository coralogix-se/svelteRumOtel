/** Single segment of assistant/user message text (plain or inline Markdown image). */
export type ChatContentPart =
	| { type: 'text'; value: string }
	| { type: 'image'; alt: string; url: string };

/**
 * `![alt](url)` or `![alt](<url>)` — Wikimedia filenames often contain `(…)`.
 * Naive `[^)]+` URLs break at the first parenthesis and show a broken image icon.
 */
const IMAGE_MARKDOWN_RE =
	/!\[([^\]]*)\]\(\s*(?:<((?:https?:\/\/|\/)[^>]+)>|((?:https?:\/\/|\/)(?:[^\s)]|\([^)]*\))+))\s*\)/gi;

/** Split message into text and `![alt](url)` image parts for chat rendering. */
export function parseChatContent(content: string): ChatContentPart[] {
	const parts: ChatContentPart[] = [];
	let lastIndex = 0;
	for (const match of content.matchAll(IMAGE_MARKDOWN_RE)) {
		const index = match.index ?? 0;
		if (index > lastIndex) {
			const text = content.slice(lastIndex, index);
			if (text) parts.push({ type: 'text', value: text });
		}
		const url = (match[2] ?? match[3] ?? '').trim();
		if (!url) continue;
		parts.push({
			type: 'image',
			alt: match[1] ?? '',
			url
		});
		lastIndex = index + match[0].length;
	}
	const tail = content.slice(lastIndex);
	if (tail) parts.push({ type: 'text', value: tail });
	if (!parts.length) parts.push({ type: 'text', value: content });
	return parts;
}
