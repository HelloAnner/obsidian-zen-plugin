const IMAGE_EXTENSIONS = new Set([
	'.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.webp', '.avif', '.heic', '.heif',
]);

const SENTINEL_PREFIX = '\uE000FEISHU_IMAGE_';
const SENTINEL_SUFFIX = '\uE001';

export interface SourceProtectedReference {
	raw: string;
	source: string;
	local: boolean;
	kind: 'markdown-image' | 'obsidian-image' | 'html-image'
		| 'markdown-attachment' | 'obsidian-attachment' | 'file-tag' | 'diagram';
	/** Local images are false; URL images and diagram source are retained on create/overwrite. */
	writeOnCreate: boolean;
}

export interface PreparedFeishuMarkdown {
	/** Markdown sent when creating/overwriting. Local images are absent. */
	markdown: string;
	/** Text around images/diagrams, used to align existing protected Feishu blocks. */
	protectedSegments: string[];
	protectedReferences: SourceProtectedReference[];
	images: SourceProtectedReference[];
	attachments: SourceProtectedReference[];
	localImageCount: number;
	localAttachmentCount: number;
}

export interface RemoteProtectedBlock {
	raw: string;
	token: string;
	kind: 'image' | 'file' | 'whiteboard' | 'mindnote' | 'diagram';
	start: number;
	end: number;
}

export interface ParsedRemoteProtectedBlocks {
	markdown: string;
	segments: string[];
	blocks: RemoteProtectedBlock[];
	images: RemoteProtectedBlock[];
}

export type FeishuPatchMode = 'replace_range' | 'insert_before' | 'insert_after' | 'delete_range';

export interface FeishuTextPatch {
	mode: FeishuPatchMode;
	selection: string;
	markdown?: string;
	segmentIndex: number;
}

export interface FeishuSafeUpdatePlan {
	safe: boolean;
	reason?: string;
	patches: FeishuTextPatch[];
	imageTokens: string[];
	protectedIdentities: string[];
	alignment: 'exact' | 'inferred';
	warning?: string;
}

interface SourceRange {
	start: number;
	end: number;
	reference: SourceProtectedReference;
}

interface TextLayout {
	text: string;
	boundaries: number[];
}

interface LineInfo {
	text: string;
	normalized: string;
	start: number;
	end: number;
	index: number;
}

interface LineAnchor {
	oldStart: number;
	oldEnd: number;
	newStart: number;
	newEnd: number;
}

/**
 * Prepare Markdown for the hosted Feishu MCP.
 *
 * Local images are retained as internal boundaries while being completely
 * omitted from the outgoing Markdown. HTTP(S) images remain writable for new
 * documents, but are also boundaries so an existing Feishu image can be kept
 * in place during a safe update.
 */
export function prepareFeishuMarkdown(content: string, codeBlockFilterLanguages: string[] = []): PreparedFeishuMarkdown {
	const filtered = filterCodeBlocks(content, codeBlockFilterLanguages);
	const ranges = findSourceProtectedReferences(filtered);
	let marked = '';
	let cursor = 0;

	ranges.forEach((range, index) => {
		marked += filtered.slice(cursor, range.start);
		marked += `${SENTINEL_PREFIX}${index}${SENTINEL_SUFFIX}`;
		cursor = range.end;
	});
	marked += filtered.slice(cursor);

	// Preserve the previous Feishu cleanup behavior for non-image Obsidian embeds
	// and ordinary wiki links. Image embeds have already become sentinels.
	marked = marked.replace(/!\[\[([^\]]+)\]\]/g, (_match, target) => {
		const name = String(target).split('|')[0].split('#')[0].trim();
		return `_(本地引用已省略: ${name})_`;
	});
	marked = marked.replace(/\[\[([^\]]+)\]\]/g, (_match, target) => {
		const parts = String(target).split('|');
		return (parts[1] || parts[0] || '').split('#')[0].trim();
	});

	const sentinelRegex = new RegExp(`${SENTINEL_PREFIX}\\d+${SENTINEL_SUFFIX}`, 'g');
	const protectedSegments = marked.split(sentinelRegex).map(normalizeSegment);
	const protectedReferences = ranges.map(range => range.reference);
	const images = protectedReferences.filter(reference => reference.kind.endsWith('-image'));
	const attachments = protectedReferences.filter(reference => isAttachmentReference(reference));
	const markdown = renderPreparedMarkdown(protectedSegments, protectedReferences);

	return {
		markdown,
		protectedSegments,
		protectedReferences,
		images,
		attachments,
		localImageCount: images.filter(image => image.local).length,
		localAttachmentCount: attachments.filter(attachment => attachment.local).length,
	};
}

/** Parse token-backed blocks returned by fetch-doc, ignoring examples in code fences. */
export function parseRemoteProtectedBlocks(markdown: string): ParsedRemoteProtectedBlocks {
	const blocks: RemoteProtectedBlock[] = [];
	const lines = splitLinesWithOffsets(markdown);
	let fence: { marker: string; length: number } | null = null;

	for (const line of lines) {
		const fenceMatch = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line.text);
		if (fenceMatch) {
			const run = fenceMatch[1];
			if (!fence) {
				fence = { marker: run[0], length: run.length };
			} else if (run[0] === fence.marker && run.length >= fence.length) {
				fence = null;
			}
			continue;
		}
		if (fence) continue;

		const protectedRegex = /<(image|file|whiteboard|mindnote|diagram)\b[^>]*>/gi;
		let match: RegExpExecArray | null;
		while ((match = protectedRegex.exec(line.text)) !== null) {
			const tokenMatch = /\btoken\s*=\s*(["'])(.*?)\1/i.exec(match[0]);
			if (!tokenMatch?.[2]) continue;
			const kind = match[1].toLowerCase() as RemoteProtectedBlock['kind'];
			let raw = match[0];
			if (kind === 'file' && !/\/>\s*$/.test(raw)) {
				const closingIndex = line.text.toLowerCase().indexOf('</file>', match.index + raw.length);
				if (closingIndex !== -1) {
					raw = line.text.slice(match.index, closingIndex + '</file>'.length);
					protectedRegex.lastIndex = closingIndex + '</file>'.length;
				}
			}
			blocks.push({
				raw,
				token: tokenMatch[2],
				kind,
				start: line.start + match.index,
				end: line.start + match.index + raw.length,
			});
		}
	}

	const segments: string[] = [];
	let cursor = 0;
	for (const block of blocks) {
		segments.push(markdown.slice(cursor, block.start));
		cursor = block.end;
	}
	segments.push(markdown.slice(cursor));

	return { markdown, segments, blocks, images: blocks.filter(block => block.kind === 'image') };
}

/** Backwards-compatible focused parser used by tests and image verification. */
export function parseRemoteImages(markdown: string): ParsedRemoteProtectedBlocks {
	return parseRemoteProtectedBlocks(markdown);
}

/**
 * Build text-only MCP patches. No patch range is allowed to contain an image
 * token. Exact image counts use source image positions; count mismatches use
 * unchanged lines as anchors and fail closed if a safe position cannot be
 * inferred.
 */
export function createSafeImageUpdatePlan(
	prepared: PreparedFeishuMarkdown,
	remote: ParsedRemoteProtectedBlocks,
): FeishuSafeUpdatePlan {
	const imageTokens = remote.images.map(image => image.token);
	const protectedIdentities = remote.blocks.map(protectedIdentity);
	if (remote.blocks.length === 0) {
		return { safe: true, patches: [], imageTokens, protectedIdentities, alignment: 'exact' };
	}
	if (remote.blocks.some(block => isInsideStructuredContainer(remote.markdown, block.start))) {
		return {
			safe: false,
			reason: '检测到图片或画板位于表格、分栏、高亮块等嵌套容器中；为避免破坏容器结构已停止更新。',
			patches: [],
			imageTokens,
			protectedIdentities,
			alignment: 'inferred',
		};
	}

	let desiredSegments: string[];
	let alignment: 'exact' | 'inferred' = 'exact';
	let warning: string | undefined;

	const exactBoundaryMatch = prepared.protectedReferences.length === remote.blocks.length
		&& prepared.protectedReferences.every((reference, index) => referenceMatchesRemote(reference, remote.blocks[index]));
	if (exactBoundaryMatch) {
		desiredSegments = prepared.protectedSegments.map(normalizeSegment);
	} else {
		const inferred = inferSegmentsAroundRemoteBlocks(prepared, remote);
		if (!inferred) {
			return {
				safe: false,
				reason: `检测到飞书已有 ${remote.blocks.length} 个图片/画板等受保护块，但本地 Markdown 中有 ${prepared.protectedReferences.length} 个对应位置；无法可靠对齐文字，为保护飞书内容已停止更新。`,
				patches: [],
				imageTokens,
				protectedIdentities,
				alignment: 'inferred',
			};
		}
		desiredSegments = inferred;
		alignment = 'inferred';
		warning = `飞书已有 ${remote.blocks.length} 个图片/画板等受保护块，本地有 ${prepared.protectedReferences.length} 个对应位置；已根据相邻未修改文字推断位置并保留原内容。`;
	}

	const unsafe = (reason: string): FeishuSafeUpdatePlan => ({
		safe: false,
		reason,
		patches: [],
		imageTokens,
		protectedIdentities,
		alignment,
	});

	if (desiredSegments.length !== remote.segments.length) {
		return unsafe('受保护内容的分段数量异常，为保护飞书内容已停止更新。');
	}

	const patches: FeishuTextPatch[] = [];
	for (let index = 0; index < remote.segments.length; index++) {
		const oldText = normalizeSegment(remote.segments[index]);
		const newText = normalizeSegment(desiredSegments[index]);
		if (oldText === newText) continue;

		if (containsOtherProtectedTokenBlock(oldText)) {
			return unsafe(`第 ${index + 1} 个文字区段中还包含无法独立保护的嵌套内容，为避免误删已停止更新。`);
		}

		if (oldText) {
			const selection = buildUniqueSelection(oldText, remote.markdown);
			if (!selection) {
				return unsafe(`受保护内容附近第 ${index + 1} 个文字区段无法唯一定位，为保护图片/画板已停止更新。`);
			}
			patches.push({
				mode: newText ? 'replace_range' : 'delete_range',
				selection,
				markdown: newText || undefined,
				segmentIndex: index,
			});
			continue;
		}

		if (!newText) continue;
		const nextBlock = remote.blocks[index];
		const previousBlock = index > 0 ? remote.blocks[index - 1] : undefined;
		if (nextBlock) {
			patches.push({
				mode: 'insert_before',
				selection: escapeLiteralEllipsis(nextBlock.raw),
				markdown: newText,
				segmentIndex: index,
			});
		} else if (previousBlock) {
			patches.push({
				mode: 'insert_after',
				selection: escapeLiteralEllipsis(previousBlock.raw),
				markdown: newText,
				segmentIndex: index,
			});
		} else {
			return unsafe('无法找到安全的文字插入锚点，为保护图片/画板已停止更新。');
		}
	}

	// Bottom-up keeps later selectors stable while preceding text changes.
	patches.sort((a, b) => b.segmentIndex - a.segmentIndex);
	return { safe: true, patches, imageTokens, protectedIdentities, alignment, warning };
}

/** Verify that every original token-backed block still exists in the same order. */
export function verifyProtectedBlocks(expectedIdentities: string[], markdown: string): boolean {
	const actual = parseRemoteProtectedBlocks(markdown).blocks.map(protectedIdentity);
	if (actual.length !== expectedIdentities.length) return false;
	return expectedIdentities.every((identity, index) => identity === actual[index]);
}

/** Verify image count/order; kept as a focused utility for callers and tests. */
export function verifyImageTokens(expectedTokens: string[], markdown: string): boolean {
	const actual = parseRemoteProtectedBlocks(markdown).images.map(image => image.token);
	if (actual.length !== expectedTokens.length) return false;
	return expectedTokens.every((token, index) => token === actual[index]);
}

function protectedIdentity(block: RemoteProtectedBlock): string {
	return `${block.kind}:${block.token}`;
}

function referenceMatchesRemote(reference: SourceProtectedReference, block: RemoteProtectedBlock): boolean {
	if (reference.kind === 'diagram') return block.kind === 'whiteboard' || block.kind === 'diagram';
	if (isAttachmentReference(reference)) return block.kind === 'file';
	return reference.kind.endsWith('-image') && block.kind === 'image';
}

function isAttachmentReference(reference: SourceProtectedReference): boolean {
	return reference.kind.endsWith('-attachment') || reference.kind === 'file-tag';
}

function isInsideStructuredContainer(markdown: string, offset: number): boolean {
	const before = markdown.slice(0, offset).toLowerCase();
	for (const tag of ['lark-table', 'lark-tr', 'lark-td', 'grid', 'column', 'callout', 'quote-container', 'source-synced']) {
		if (before.lastIndexOf(`<${tag}`) > before.lastIndexOf(`</${tag}>`)) return true;
	}
	return false;
}

function renderPreparedMarkdown(segments: string[], references: SourceProtectedReference[]): string {
	const pieces: string[] = [];
	for (let index = 0; index < segments.length; index++) {
		if (segments[index]) pieces.push(segments[index]);
		const reference = references[index];
		if (reference?.writeOnCreate) pieces.push(reference.raw.trim());
	}
	return pieces.filter(Boolean).join('\n\n').trim();
}

function filterCodeBlocks(content: string, languages: string[]): string {
	const filters = languages.map(value => value.toLowerCase());
	if (filters.length === 0) return content;
	const fencedRegex = /(^|\n)(```|~~~)\s*([^\n]*)\n([\s\S]*?)\n\2\s*(?=\n|$)/g;
	return content.replace(fencedRegex, (full, leading, _fence, info) => {
		const language = String(info || '').trim().split(/\s+/)[0].toLowerCase();
		return language && filters.includes(language) ? leading || '' : full;
	});
}

function findSourceProtectedReferences(markdown: string): SourceRange[] {
	const ranges: SourceRange[] = [];
	const lines = splitLinesWithOffsets(markdown);
	let fence: { marker: string; length: number; start: number; language: string } | null = null;

	for (const line of lines) {
		const fenceMatch = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line.text);
		if (fenceMatch) {
			const run = fenceMatch[1];
			if (!fence) {
				const language = line.text.slice(fenceMatch[0].length).trim().split(/\s+/)[0].toLowerCase();
				fence = { marker: run[0], length: run.length, start: line.start, language };
			} else if (run[0] === fence.marker && run.length >= fence.length) {
				if (fence.language === 'mermaid' || fence.language === 'plantuml') {
					const end = line.start + line.text.length;
					ranges.push({
						start: fence.start,
						end,
						reference: {
							raw: markdown.slice(fence.start, end),
							source: fence.language,
							local: false,
							kind: 'diagram',
							writeOnCreate: true,
						},
					});
				}
				fence = null;
			}
			continue;
		}
		if (fence) continue;
		scanSourceImagesInLine(line.text, line.start, ranges);
	}
	return ranges.sort((a, b) => a.start - b.start);
}

function scanSourceImagesInLine(line: string, lineOffset: number, ranges: SourceRange[]): void {
	let index = 0;
	while (index < line.length) {
		if (line[index] === '`') {
			const runLength = countRun(line, index, '`');
			const closing = line.indexOf('`'.repeat(runLength), index + runLength);
			index = closing === -1 ? line.length : closing + runLength;
			continue;
		}

		if (line.startsWith('![[', index)) {
			const end = line.indexOf(']]', index + 3);
			if (end !== -1) {
				const raw = line.slice(index, end + 2);
				const target = raw.slice(3, -2).split('|')[0].split('#')[0].trim();
				const kind = isImageFile(target)
					? 'obsidian-image'
					: (isAttachmentFile(target) ? 'obsidian-attachment' : null);
				if (kind) {
					ranges.push({
						start: lineOffset + index,
						end: lineOffset + end + 2,
						reference: {
							raw,
							source: target,
							local: true,
							kind,
							writeOnCreate: false,
						},
					});
					index = end + 2;
					continue;
				}
			}
		}

		if (line.startsWith('![', index) && !line.startsWith('![[', index)) {
			const parsed = parseMarkdownResource(line, index, 2);
			if (parsed) {
				const local = !isHttpUrl(parsed.source);
				const attachment = isAttachmentFile(parsed.source) && !isImageFile(parsed.source);
				ranges.push({
					start: lineOffset + index,
					end: lineOffset + parsed.end,
					reference: {
						raw: line.slice(index, parsed.end),
						source: parsed.source,
						local,
						kind: attachment ? 'markdown-attachment' : 'markdown-image',
						writeOnCreate: !local,
					},
				});
				index = parsed.end;
				continue;
			}
		}

		if (line[index] === '[' && !line.startsWith('[[', index) && line[index - 1] !== '!') {
			const parsed = parseMarkdownResource(line, index, 1);
			if (parsed && !isHttpUrl(parsed.source) && isAttachmentFile(parsed.source)) {
				ranges.push({
					start: lineOffset + index,
					end: lineOffset + parsed.end,
					reference: {
						raw: line.slice(index, parsed.end),
						source: parsed.source,
						local: true,
						kind: 'markdown-attachment',
						writeOnCreate: false,
					},
				});
				index = parsed.end;
				continue;
			}
		}

		if (line[index] === '<' && /^<file\b/i.test(line.slice(index))) {
			const close = line.indexOf('>', index + 5);
			if (close !== -1) {
				let end = close + 1;
				const opening = line.slice(index, end);
				if (!/\/>\s*$/.test(opening)) {
					const closing = line.toLowerCase().indexOf('</file>', end);
					if (closing !== -1) end = closing + '</file>'.length;
				}
				const raw = line.slice(index, end);
				const source = extractHtmlAttribute(opening, 'url');
				if (source) {
					const local = !isHttpUrl(source);
					ranges.push({
						start: lineOffset + index,
						end: lineOffset + end,
						reference: { raw, source, local, kind: 'file-tag', writeOnCreate: !local },
					});
					index = end;
					continue;
				}
			}
		}

		if (line[index] === '<' && /^<img\b/i.test(line.slice(index))) {
			const close = line.indexOf('>', index + 4);
			if (close !== -1) {
				const raw = line.slice(index, close + 1);
				const source = extractHtmlAttribute(raw, 'src');
				if (source) {
					const local = !isHttpUrl(source);
					ranges.push({
						start: lineOffset + index,
						end: lineOffset + close + 1,
						reference: {
							raw,
							source,
							local,
							kind: 'html-image',
							writeOnCreate: !local,
						},
					});
					index = close + 1;
					continue;
				}
			}
		}
		index++;
	}
}

function parseMarkdownResource(line: string, start: number, markerLength: 1 | 2): { end: number; source: string } | null {
	let bracketEnd = start + markerLength;
	for (; bracketEnd < line.length; bracketEnd++) {
		if (line[bracketEnd] === '\\') {
			bracketEnd++;
			continue;
		}
		if (line[bracketEnd] === ']') break;
	}
	if (bracketEnd >= line.length || line[bracketEnd + 1] !== '(') return null;

	let depth = 1;
	let quote = '';
	let end = bracketEnd + 2;
	for (; end < line.length; end++) {
		const char = line[end];
		if (char === '\\') {
			end++;
			continue;
		}
		if (quote) {
			if (char === quote) quote = '';
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (char === '(') depth++;
		if (char === ')' && --depth === 0) break;
	}
	if (depth !== 0 || end >= line.length) return null;

	const interior = line.slice(bracketEnd + 2, end).trim();
	const source = extractMarkdownDestination(interior);
	if (!source) return null;
	return { end: end + 1, source };
}

function extractMarkdownDestination(interior: string): string {
	if (interior.startsWith('<')) {
		const end = interior.indexOf('>');
		return end === -1 ? '' : interior.slice(1, end).trim();
	}
	let depth = 0;
	for (let index = 0; index < interior.length; index++) {
		const char = interior[index];
		if (char === '\\') {
			index++;
			continue;
		}
		if (char === '(') depth++;
		else if (char === ')') depth = Math.max(0, depth - 1);
		else if (/\s/.test(char) && depth === 0) return interior.slice(0, index).trim();
	}
	return interior.trim();
}

function extractHtmlAttribute(tag: string, name: string): string {
	const quoted = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag);
	if (quoted) return quoted[2].trim();
	const bare = new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, 'i').exec(tag);
	return bare?.[1]?.trim() || '';
}

function isHttpUrl(source: string): boolean {
	return /^https?:\/\//i.test(source.trim());
}

function isImageFile(path: string): boolean {
	const clean = cleanFilePath(path);
	for (const extension of IMAGE_EXTENSIONS) {
		if (clean.endsWith(extension)) return true;
	}
	return false;
}

function isAttachmentFile(path: string): boolean {
	const clean = cleanFilePath(path);
	const name = clean.split('/').pop() || '';
	const dot = name.lastIndexOf('.');
	if (dot <= 0 || dot === name.length - 1) return false;
	const extension = name.slice(dot);
	return extension !== '.md' && extension !== '.markdown';
}

function cleanFilePath(path: string): string {
	return decodeURIComponentSafe(path).split('?')[0].split('#')[0].replace(/\\/g, '/').toLowerCase();
}

function decodeURIComponentSafe(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch (_error) {
		return value;
	}
}

function inferSegmentsAroundRemoteBlocks(
	prepared: PreparedFeishuMarkdown,
	remote: ParsedRemoteProtectedBlocks,
): string[] | null {
	const oldLayout = buildTextLayout(remote.segments);
	const newLayout = buildTextLayoutFromPrepared(prepared);
	const anchors = buildLineAnchors(oldLayout.text, newLayout.text);
	const mapped: number[] = [];

	for (let index = 0; index < remote.blocks.length; index++) {
		const oldBoundary = oldLayout.boundaries[index];
		const target = mapBoundary(oldBoundary, oldLayout.text, newLayout.text, newLayout.boundaries, anchors);
		if (target === null) return null;
		if (mapped.length > 0 && target < mapped[mapped.length - 1]) return null;
		mapped.push(target);
	}

	const segments: string[] = [];
	let cursor = 0;
	for (const boundary of mapped) {
		segments.push(newLayout.text.slice(cursor, boundary));
		cursor = boundary;
	}
	segments.push(newLayout.text.slice(cursor));
	return segments.map(normalizeSegment);
}

function buildTextLayout(segments: string[]): TextLayout {
	const normalized = segments.map(normalizeSegment);
	let text = '';
	const boundaries: number[] = [];
	for (let index = 0; index < normalized.length; index++) {
		const segment = normalized[index];
		if (segment) {
			if (text) text += '\n\n';
			text += segment;
		}
		if (index < normalized.length - 1) boundaries.push(text.length);
	}
	return { text, boundaries };
}

function buildTextLayoutFromPrepared(prepared: PreparedFeishuMarkdown): TextLayout {
	// Every source image is removed here, including HTTP images: existing remote
	// image blocks are preserved instead of reconstructed from read-only tokens.
	return buildTextLayout(prepared.protectedSegments);
}

function buildLineAnchors(oldText: string, newText: string): LineAnchor[] {
	const oldLines = lineInfos(oldText);
	const newLines = lineInfos(newText);
	const oldCounts = countNormalizedLines(oldLines);
	const newByText = new Map<string, LineInfo[]>();
	for (const line of newLines) {
		if (!line.normalized) continue;
		const values = newByText.get(line.normalized) || [];
		values.push(line);
		newByText.set(line.normalized, values);
	}

	const candidates: Array<{ old: LineInfo; next: LineInfo }> = [];
	for (const old of oldLines) {
		if (old.normalized.length < 6 || oldCounts.get(old.normalized) !== 1) continue;
		const matches = newByText.get(old.normalized);
		if (matches?.length === 1) candidates.push({ old, next: matches[0] });
	}

	// Longest increasing subsequence by new line index prevents moved/reordered
	// paragraphs from becoming unsafe cross-document anchors.
	const lis = longestIncreasingAnchorSubsequence(candidates);
	return lis.map(pair => ({
		oldStart: pair.old.start,
		oldEnd: pair.old.end,
		newStart: pair.next.start,
		newEnd: pair.next.end,
	}));
}

function mapBoundary(
	oldBoundary: number,
	oldText: string,
	newText: string,
	explicitBoundaries: number[],
	anchors: LineAnchor[],
): number | null {
	if (oldBoundary <= 0) return 0;
	if (oldBoundary >= oldText.length) return newText.length;

	let before: LineAnchor | undefined;
	let after: LineAnchor | undefined;
	for (const anchor of anchors) {
		if (anchor.oldEnd <= oldBoundary) before = anchor;
		if (!after && anchor.oldStart >= oldBoundary) after = anchor;
	}
	if (!before && !after) return null;

	let estimate: number;
	if (before && after && after.oldStart > before.oldEnd) {
		const oldSpan = after.oldStart - before.oldEnd;
		const newSpan = Math.max(0, after.newStart - before.newEnd);
		const ratio = Math.max(0, Math.min(1, (oldBoundary - before.oldEnd) / oldSpan));
		estimate = Math.round(before.newEnd + ratio * newSpan);
	} else if (before) {
		if (oldBoundary - before.oldEnd > 4000) return null;
		estimate = before.newEnd + (oldBoundary - before.oldEnd);
	} else {
		if (!after || after.oldStart - oldBoundary > 4000) return null;
		estimate = after.newStart - (after.oldStart - oldBoundary);
	}
	estimate = Math.max(0, Math.min(newText.length, estimate));

	const sourceBoundary = nearestNumber(explicitBoundaries, estimate);
	if (sourceBoundary !== null && Math.abs(sourceBoundary - estimate) <= 500) return sourceBoundary;

	const blockBoundaries = findBlockBoundaries(newText, estimate, 400);
	const blockBoundary = nearestNumber(blockBoundaries, estimate);
	return blockBoundary;
}

function findBlockBoundaries(text: string, center: number, radius: number): number[] {
	const values: number[] = [];
	const start = Math.max(0, center - radius);
	const end = Math.min(text.length, center + radius);
	const fragment = text.slice(start, end);
	const regex = /\n\s*\n/g;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(fragment)) !== null) values.push(start + match.index + match[0].length);
	if (start === 0) values.push(0);
	if (end === text.length) values.push(text.length);
	return values;
}

function buildUniqueSelection(oldText: string, fullMarkdown: string): string | null {
	if (oldText.length <= 240 && countOccurrences(fullMarkdown, oldText) === 1) {
		return escapeLiteralEllipsis(oldText);
	}

	for (const size of [24, 40, 64, 96, 160, 240]) {
		if (oldText.length <= size * 2) continue;
		const start = oldText.slice(0, size);
		const end = oldText.slice(-size);
		if (countOccurrences(fullMarkdown, start) === 1 && countOccurrences(fullMarkdown, end) === 1) {
			return `${escapeLiteralEllipsis(start)}...${escapeLiteralEllipsis(end)}`;
		}
	}

	if (oldText.length <= 1200 && countOccurrences(fullMarkdown, oldText) === 1) {
		return escapeLiteralEllipsis(oldText);
	}
	return null;
}

function containsOtherProtectedTokenBlock(text: string): boolean {
	return /<(?:file|whiteboard|mindnote|diagram)\b[^>]*\btoken\s*=/i.test(text)
		|| /<(?:sheet|bitable|reference-synced|source-synced)\b/i.test(text);
}

function escapeLiteralEllipsis(value: string): string {
	return value.replace(/\.\.\./g, '\\.\\.\\.');
}

function normalizeSegment(value: string): string {
	return value.replace(/\r\n/g, '\n').trim();
}

function countOccurrences(haystack: string, needle: string): number {
	if (!needle) return 0;
	let count = 0;
	let offset = 0;
	while ((offset = haystack.indexOf(needle, offset)) !== -1) {
		count++;
		offset += Math.max(1, needle.length);
	}
	return count;
}

function splitLinesWithOffsets(text: string): Array<{ text: string; start: number }> {
	const result: Array<{ text: string; start: number }> = [];
	let start = 0;
	for (let index = 0; index <= text.length; index++) {
		if (index === text.length || text[index] === '\n') {
			result.push({ text: text.slice(start, index), start });
			start = index + 1;
		}
	}
	return result;
}

function lineInfos(text: string): LineInfo[] {
	return splitLinesWithOffsets(text).map((line, index) => ({
		text: line.text,
		normalized: line.text.trim().replace(/\s+/g, ' '),
		start: line.start,
		end: line.start + line.text.length,
		index,
	}));
}

function countNormalizedLines(lines: LineInfo[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const line of lines) {
		if (!line.normalized) continue;
		counts.set(line.normalized, (counts.get(line.normalized) || 0) + 1);
	}
	return counts;
}

function longestIncreasingAnchorSubsequence(
	pairs: Array<{ old: LineInfo; next: LineInfo }>,
): Array<{ old: LineInfo; next: LineInfo }> {
	if (pairs.length <= 1) return pairs;
	const lengths = pairs.map(() => 1);
	const previous = pairs.map(() => -1);
	let best = 0;
	for (let index = 0; index < pairs.length; index++) {
		for (let prior = 0; prior < index; prior++) {
			if (pairs[prior].next.index < pairs[index].next.index && lengths[prior] + 1 > lengths[index]) {
				lengths[index] = lengths[prior] + 1;
				previous[index] = prior;
			}
		}
		if (lengths[index] > lengths[best]) best = index;
	}
	const result: Array<{ old: LineInfo; next: LineInfo }> = [];
	for (let index = best; index !== -1; index = previous[index]) result.push(pairs[index]);
	return result.reverse();
}

function nearestNumber(values: number[], target: number): number | null {
	if (values.length === 0) return null;
	let nearest = values[0];
	let distance = Math.abs(values[0] - target);
	for (let index = 1; index < values.length; index++) {
		const nextDistance = Math.abs(values[index] - target);
		if (nextDistance < distance) {
			nearest = values[index];
			distance = nextDistance;
		}
	}
	return nearest;
}

function countRun(value: string, start: number, character: string): number {
	let length = 0;
	while (value[start + length] === character) length++;
	return length;
}
