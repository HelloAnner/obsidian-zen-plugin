import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfluenceMarkdownConverter } from '../src/publish/confluence/markdown-to-confluence';

const convert = (markdown: string) => new ConfluenceMarkdownConverter().convert(markdown);
const mark = (text: string) => `<span style="background-color: #FFEBE6; color: #172B4D;">${text}</span>`;

test('converts Obsidian highlights in headings, paragraphs and callouts', async () => {
	const html = await convert('## 1. ==标题高亮==\n\n正文==**加粗**与 `a==b`==，再 ==高亮==。\n\n> [!note] 提醒\n> 这里有 ==高亮==。');
	assert.ok(html.includes(`<h2>1. ${mark('标题高亮')}</h2>`), html);
	assert.ok(html.includes(`<p>正文${mark('<strong>加粗</strong>与 <code>a==b</code>')}，再 ${mark('高亮')}。</p>`), html);
	assert.ok(html.includes(`<ac:rich-text-body><p>这里有 ${mark('高亮')}。</p></ac:rich-text-body>`), html);
});

test('exports Zen wavy underlines while preserving ordinary underlines and strikethrough', async () => {
	const html = await convert('## <u class="zen-wavy">波浪线</u>\n\n<u>普通下划线</u>与 ~~删除线~~。\n\n> [!note] 提醒\n> <u class="zen-wavy">提示波浪线</u>');
	assert.ok(html.includes('<h2><u style="text-decoration-style: wavy;">波浪线</u></h2>'), html);
	assert.ok(html.includes('<u>普通下划线</u>与 <del>删除线</del>。'), html);
	assert.ok(html.includes('<p><u style="text-decoration-style: wavy;">提示波浪线</u></p>'), html);
});

test('preserves literal equal signs and existing HTML highlight colors', async () => {
	const html = await convert([
		'`==行内代码==`',
		'\\==转义==',
		'&#61;&#61;实体&#61;&#61;',
		'==未闭合',
		'===普通文字=== 与 a == b == c',
		'```js\na == b; // ==代码==\n```',
		'<mark style="background-color: #000">原有高亮</mark>',
	].join('\n\n'));
	for (const literal of ['<code>==行内代码==</code>', '==转义==', '==实体==', '==未闭合']) {
		assert.ok(html.includes(`<p>${literal}</p>`), html);
	}
	assert.ok(html.includes('===普通文字=== 与 a == b == c'), html);
	assert.ok(html.includes('<![CDATA[a == b; // ==代码=='), html);
	assert.ok(html.includes('<span style="background-color: #000000; color: #FFFFFF;">原有高亮</span>'), html);
});
