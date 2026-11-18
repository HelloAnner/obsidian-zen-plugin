import { Plugin } from 'obsidian';
import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';

/**
 * Zen 标题自动编号
 * 约定：H2(##) 是顶层章节 → 1. 2. 3.；H3 → 1.1；H4 → 1.1.1 …（H1 不编号）
 * 阅读模式由 CSS 计数器渲染（styles.css，zen-heading-numbers）；
 * 编辑模式（Live Preview/源码）由本 CM6 插件按语法树计算（CSS 计数器在虚拟滚动下会错乱）。
 */
export class ZenHeadingNumbersFeature {
  constructor(private plugin: Plugin) {}

  load(): void {
    this.plugin.registerEditorExtension([headingNumberViewPlugin]);
  }
}

class HeadingNumberWidget extends WidgetType {
  constructor(private text: string) {
    super();
  }
  eq(other: HeadingNumberWidget): boolean {
    return other.text === this.text;
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'zen-heading-number';
    span.textContent = this.text;
    return span;
  }
}

const HEADING_RE = /^ATXHeading([1-6])$/;

function buildDecorations(view: EditorView): DecorationSet {
  const counters = [0, 0, 0, 0, 0, 0, 0]; // 下标 = 标题级别
  const builder = new RangeSetBuilder<Decoration>();

  syntaxTree(view.state).iterate({
    enter: (node) => {
      const m = HEADING_RE.exec(node.name);
      if (!m) return;
      const level = Number(m[1]);
      if (level === 1) return; // H1 不编号

      counters[level]++;
      for (let l = level + 1; l <= 6; l++) counters[l] = 0;

      // 顶层 H2 显示 "1. "，更深层级显示 "1.1 " / "1.1.1 "
      const text =
        level === 2
          ? `${counters[2]}. `
          : `${Array.from({ length: level - 1 }, (_, i) => counters[i + 2]).join('.')} `;

      builder.add(
        node.from,
        node.from,
        Decoration.widget({ widget: new HeadingNumberWidget(text), side: -1 })
      );
    },
  });

  return builder.finish();
}

const headingNumberViewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(u: ViewUpdate): void {
      const treeChanged = syntaxTree(u.state) !== syntaxTree(u.startState);
      if (u.docChanged || u.viewportChanged || treeChanged) {
        this.decorations = buildDecorations(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);
