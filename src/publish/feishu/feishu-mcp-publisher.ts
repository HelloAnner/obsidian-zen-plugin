import { App, Notice, TFile } from 'obsidian';
import { FeishuSettings, FrontMatterData, ShareResult } from '../types';
import { MarkdownProcessor } from '../markdown-processor';
import { McpHttpClient, McpError } from './mcp-client';
import { Debug } from '../debug';
import {
	FeishuTextPatch,
	PreparedFeishuMarkdown,
	createSafeImageUpdatePlan,
	parseRemoteProtectedBlocks,
	prepareFeishuMarkdown,
	verifyProtectedBlocks,
} from './feishu-image-safe-update';

/** secretStorage key holding the personal Feishu MCP URL (never in data.json). */
export const FEISHU_MCP_URL_SECRET_ID = 'feishu-mcp-url';

const PARENT_LINK_KEYS = [
	'feishu',
	'feishu_parent',
	'feishu.parent',
	'feishu_parent_url',
	'parent_feishu_url',
	'feishu_parent_link',
];

interface McpChildDoc {
	title: string;
	url?: string;
}

interface McpFetchedDocument {
	docId: string;
	title: string;
	markdown: string;
}

interface McpUpdateSummary {
	preservedImageCount: number;
	warnings: string[];
}

/**
 * Publishes notes through the hosted Feishu MCP server (mcp.feishu.cn).
 * The MCP URL is a personal key supplied via `getMcpUrl` (backed by the
 * system keychain, never written to data.json).
 *
 * State machine matches the KMS publisher:
 *  1. feishu_url identifies an existing page → overwrite via update-doc;
 *  2. otherwise look for a same-titled child under the feishu parent wiki
 *     node (list-docs) → overwrite it;
 *  3. otherwise create-doc below the parent node;
 *  4. every successful publish returns the canonical URL for backfill.
 */
export class FeishuMcpPublisher {
	private readonly mcp: McpHttpClient;

	constructor(
		private readonly app: App,
		private settings: FeishuSettings,
		private readonly markdownProcessor: MarkdownProcessor,
		getMcpUrl: () => string | null,
	) {
		this.mcp = new McpHttpClient(getMcpUrl);
	}

	updateSettings(settings: FeishuSettings): void {
		this.settings = settings;
	}

	isConfigured(): boolean {
		return this.settings.feishuMcpUrlSaved;
	}

	/** Used by the settings tab "测试连接" button. */
	async testConnection(): Promise<{ userName?: string; tools: string[] }> {
		const tools = await this.mcp.listTools();
		let userName: string | undefined;
		try {
			const user = await this.mcp.callTool<Record<string, any>>('get-user', {});
			userName = this.findStringField(user, ['name']) || undefined;
		} catch (error) {
			Debug.log('get-user probe failed during connection test:', this.describeError(error));
		}
		return { userName, tools: tools.map(tool => tool.name) };
	}

	async publishFile(file: TFile, statusNotice?: Notice): Promise<ShareResult> {
		if (!this.isConfigured()) {
			return { success: false, error: '请先在插件设置中填入飞书 MCP URL' };
		}

		try {
			const rawContent = await this.app.vault.read(file);
			const { content: stripped, frontMatter } = this.markdownProcessor.processFrontMatter(
				rawContent,
				this.settings.frontMatterHandling,
			);
			// KMS always follows the current file name, including rename updates.
			const title = file.basename;
			const prepared = prepareFeishuMarkdown(stripped, this.settings.codeBlockFilterLanguages || []);
			if (prepared.localImageCount > 0 || prepared.localAttachmentCount > 0) {
				Debug.log(
					`[Feishu] Ignoring ${prepared.localImageCount} local image(s) and ${prepared.localAttachmentCount} local attachment(s); positions retained for safe update.`,
				);
			}
			const parentLink = this.pickParentLink(frontMatter);
			if (!parentLink) {
				return { success: false, error: '当前笔记缺少 feishu 属性，请填写飞书 Wiki 父页面链接' };
			}

			const existingUrl = this.pickFeishuUrl(frontMatter);
			if (existingUrl) {
				const existing = await this.tryFetchDocument(existingUrl);
				if (existing) {
					statusNotice?.setMessage('🔄 正在安全更新飞书页面…');
					const summary = await this.updateDocument(existingUrl, title, prepared, existing);
					return {
						success: true,
						url: existingUrl,
						title,
						operation: 'updated',
						ignoredLocalImageCount: prepared.localImageCount,
						ignoredLocalAttachmentCount: prepared.localAttachmentCount,
						preservedImageCount: summary.preservedImageCount,
						warnings: summary.warnings,
					};
				}
			}

			statusNotice?.setMessage('🔍 正在定位飞书子页面…');
			const matched = await this.findChildDocumentByTitle(parentLink, title);
			if (matched?.url) {
				statusNotice?.setMessage('🔄 正在安全更新飞书页面…');
				const existing = await this.fetchDocument(matched.url);
				const summary = await this.updateDocument(matched.url, title, prepared, existing);
				return {
					success: true,
					url: matched.url,
					title,
					operation: 'updated',
					ignoredLocalImageCount: prepared.localImageCount,
					ignoredLocalAttachmentCount: prepared.localAttachmentCount,
					preservedImageCount: summary.preservedImageCount,
					warnings: summary.warnings,
				};
			}

			statusNotice?.setMessage('📤 正在新建飞书子页面…');
			const created = await this.createDocument(title, prepared.markdown, parentLink);
			created.ignoredLocalImageCount = prepared.localImageCount;
			created.ignoredLocalAttachmentCount = prepared.localAttachmentCount;
			return created;
		} catch (error) {
			Debug.error('FeishuMcpPublisher.publishFile error:', error);
			return { success: false, error: this.describeError(error) };
		}
	}

	private async createDocument(title: string, markdown: string, parentLink: string): Promise<ShareResult> {
		const result = await this.mcp.callTool<Record<string, any>>('create-doc', {
			title,
			markdown,
			wiki_node: parentLink,
		});

		const taskId = this.findStringField(result, ['task_id', 'taskId']);
		let docUrl = this.findStringField(result, ['doc_url', 'docUrl', 'url']);
		if (!docUrl && taskId) {
			const polled = await this.pollCreateTask(taskId);
			docUrl = this.findStringField(polled, ['doc_url', 'docUrl', 'url']);
		}
		if (!docUrl) {
			return { success: false, error: this.findStringField(result, ['message']) || 'MCP 创建文档未返回 doc_url' };
		}
		return { success: true, url: docUrl, title, operation: 'created' };
	}

	private async updateDocument(
		docIdOrUrl: string,
		title: string,
		prepared: PreparedFeishuMarkdown,
		existing: McpFetchedDocument,
	): Promise<McpUpdateSummary> {
		const remote = parseRemoteProtectedBlocks(existing.markdown);
		if (remote.blocks.length === 0) {
			await this.callUpdateTool({
				doc_id: docIdOrUrl,
				mode: 'overwrite',
				markdown: prepared.markdown,
				new_title: title,
			});
			return { preservedImageCount: 0, warnings: [] };
		}

		const plan = createSafeImageUpdatePlan(prepared, remote);
		if (!plan.safe) throw new Error(plan.reason || '无法安全更新包含图片的飞书页面');

		let titleApplied = existing.title === title;
		for (const patch of plan.patches) {
			const args = this.buildPatchArgs(docIdOrUrl, patch);
			if (!titleApplied) {
				args.new_title = title;
				titleApplied = true;
			}
			await this.callUpdateTool(args);
		}

		// A document whose text is already current may still need a rename. The
		// append mode with empty Markdown updates only the title and does not put
		// any protected image inside an update range.
		if (!titleApplied) {
			await this.callUpdateTool({
				doc_id: docIdOrUrl,
				mode: 'append',
				markdown: '',
				new_title: title,
			});
		}

		const verified = await this.fetchDocumentWithRetry(docIdOrUrl);
		if (!verifyProtectedBlocks(plan.protectedIdentities, verified.markdown)) {
			throw new Error('飞书文字已更新，但受保护内容校验失败：图片/画板等内容的数量、顺序或 token 发生变化，请立即检查页面');
		}

		return {
			preservedImageCount: plan.imageTokens.length,
			warnings: plan.warning ? [plan.warning] : [],
		};
	}

	private buildPatchArgs(docIdOrUrl: string, patch: FeishuTextPatch): Record<string, unknown> {
		const args: Record<string, unknown> = {
			doc_id: docIdOrUrl,
			mode: patch.mode,
			selection_with_ellipsis: patch.selection,
		};
		if (patch.markdown !== undefined) args.markdown = patch.markdown;
		return args;
	}

	private async callUpdateTool(args: Record<string, unknown>): Promise<void> {
		const result = await this.mcp.callTool<Record<string, any>>('update-doc', args);
		const taskId = this.findStringField(result, ['task_id', 'taskId']);
		if (!taskId) return;

		for (let attempt = 0; attempt < 12; attempt++) {
			await new Promise(resolve => setTimeout(resolve, 2500));
			const status = await this.mcp.callTool<Record<string, any>>('update-doc', {
				task_id: taskId,
				mode: args.mode,
			});
			const nextTaskId = this.findStringField(status, ['task_id', 'taskId']);
			if (!nextTaskId) return;
		}
		throw new Error('飞书文档更新任务等待超时');
	}

	private async pollCreateTask(taskId: string, maxAttempts = 12, intervalMs = 2500): Promise<Record<string, any>> {
		for (let i = 0; i < maxAttempts; i++) {
			await new Promise(resolve => setTimeout(resolve, intervalMs));
			const status = await this.mcp.callTool<Record<string, any>>('create-doc', { task_id: taskId });
			if (this.findStringField(status, ['doc_url', 'docUrl', 'url'])) return status;
		}
		return {};
	}

	private async tryFetchDocument(docUrlOrId: string): Promise<McpFetchedDocument | null> {
		try {
			return await this.fetchDocument(docUrlOrId);
		} catch (error) {
			Debug.log('fetch-doc failed, will fall back to title match:', this.describeError(error));
			return null;
		}
	}

	private async fetchDocument(docUrlOrId: string): Promise<McpFetchedDocument> {
		const first = await this.mcp.callTool<Record<string, any>>('fetch-doc', {
			doc_id: docUrlOrId,
			skip_task_detail: true,
		});
		let markdown = this.findStringField(first, ['markdown']);
		const title = this.findStringField(first, ['title']);
		const docId = this.findStringField(first, ['doc_id', 'docId']) || docUrlOrId;
		const totalLength = this.numberField(first, ['total_length', 'totalLength']);
		let offset = this.numberField(first, ['offset']) || 0;
		let received = this.numberField(first, ['length']) || markdown.length;

		if (!markdown && totalLength > 0) {
			throw new Error('飞书 fetch-doc 未返回文档 Markdown 内容');
		}

		const visited = new Set<number>();
		while (totalLength > 0 && offset + received < totalLength) {
			const nextOffset = offset + received;
			if (visited.has(nextOffset)) throw new Error('飞书文档分页读取未前进');
			visited.add(nextOffset);
			const page = await this.mcp.callTool<Record<string, any>>('fetch-doc', {
				doc_id: docUrlOrId,
				offset: nextOffset,
				limit: 50000,
				skip_task_detail: true,
			});
			const chunk = this.findStringField(page, ['markdown']);
			if (!chunk) throw new Error('飞书文档分页读取返回空内容');
			markdown += chunk;
			offset = this.numberField(page, ['offset']) || nextOffset;
			received = this.numberField(page, ['length']) || chunk.length;
		}

		return { docId, title, markdown };
	}

	private async fetchDocumentWithRetry(docUrlOrId: string): Promise<McpFetchedDocument> {
		let lastError: unknown;
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				return await this.fetchDocument(docUrlOrId);
			} catch (error) {
				lastError = error;
				if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
			}
		}
		throw lastError instanceof Error ? lastError : new Error(String(lastError));
	}

	private numberField(source: Record<string, any>, keys: string[]): number {
		for (const key of keys) {
			const value = Number(source?.[key]);
			if (Number.isFinite(value) && value >= 0) return value;
		}
		return 0;
	}

	/** list-docs returns direct children of a wiki node; paginate and match by exact title. */
	private async findChildDocumentByTitle(parentLink: string, title: string): Promise<McpChildDoc | null> {
		let pageToken = '';
		const visited = new Set<string>();
		for (let page = 0; page < 20; page++) {
			const args: Record<string, unknown> = { doc_id: parentLink, page_size: 50 };
			if (pageToken) args.page_token = pageToken;
			const result = await this.mcp.callTool<Record<string, any>>('list-docs', args);
			const items = this.extractArray(result);
			const match = items
				.map(item => ({
					title: this.findStringField(item, ['title', 'name']),
					url: this.findStringField(item, ['url', 'doc_url', 'docUrl', 'wiki_url', 'node_url']) || undefined,
				}))
				.find(item => item.title === title && !!item.url);
			if (match) return match;

			const nextToken = this.findStringField(result, ['page_token', 'next_page_token', 'nextPageToken']);
			const hasMore = result.has_more === true || result.hasMore === true || !!nextToken;
			if (!hasMore || !nextToken || visited.has(nextToken)) return null;
			visited.add(nextToken);
			pageToken = nextToken;
		}
		return null;
	}

	private extractArray(result: Record<string, any>): Array<Record<string, any>> {
		if (Array.isArray(result)) return result;
		for (const key of ['items', 'children', 'docs', 'nodes', 'list', 'data']) {
			const value = result?.[key];
			if (Array.isArray(value)) return value;
			if (value && typeof value === 'object') {
				const nested = this.extractArray(value);
				if (nested.length > 0) return nested;
			}
		}
		return [];
	}

	/** Depth-limited search for the first non-empty string among candidate keys. */
	private findStringField(source: unknown, keys: string[], depth = 0): string {
		if (!source || typeof source !== 'object' || depth > 3) return '';
		for (const key of keys) {
			const value = (source as Record<string, any>)[key];
			if (typeof value === 'string' && value.trim()) return value.trim();
		}
		if (depth < 3) {
			for (const value of Object.values(source as Record<string, any>)) {
				if (value && typeof value === 'object' && !Array.isArray(value)) {
					const found = this.findStringField(value, keys, depth + 1);
					if (found) return found;
				}
			}
		}
		return '';
	}

	private pickFeishuUrl(frontMatter: FrontMatterData | null): string | undefined {
		const raw = frontMatter?.feishu_url;
		return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
	}

	private pickParentLink(frontMatter: FrontMatterData | null): string | undefined {
		if (!frontMatter) return undefined;
		for (const key of PARENT_LINK_KEYS) {
			const value = frontMatter[key];
			if (typeof value === 'string' && value.trim()) return value.trim();
		}
		return undefined;
	}

	private describeError(error: unknown): string {
		if (error instanceof McpError) {
			// Expired/revoked links surface as JSON-RPC auth errors.
			if (/token|auth|expire|invalid|forbidden|unauthorized/i.test(error.message)) {
				return `MCP 链接已失效或被重置，请到飞书开放平台重新复制 MCP 服务器链接（${error.message}）`;
			}
			return `MCP 错误 (${error.code})：${error.message}`;
		}
		return error instanceof Error ? error.message : String(error);
	}
}
