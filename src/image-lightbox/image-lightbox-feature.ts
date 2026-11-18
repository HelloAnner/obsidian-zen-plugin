import { App, Modal, Plugin } from 'obsidian';

/**
 * Zen 图片灯箱
 * 双击正文中的图片（阅读/编辑模式均可）→ 弹出大图查看
 * Esc 或点击背景关闭；点击图片可在「适应窗口 / 原始尺寸」间切换
 */
export class ZenImageLightboxFeature {
  constructor(private plugin: Plugin) {}

  private get app() {
    return this.plugin.app;
  }

  load(): void {
    this.plugin.registerDomEvent(document, 'dblclick', (e) => {
      const target = e.target as HTMLElement;
      if (!(target instanceof HTMLImageElement)) return;
      if (!target.closest('.markdown-preview-view, .markdown-source-view')) return;
      e.preventDefault();
      e.stopPropagation();
      new ImageLightboxModal(this.app, target.src, target.alt).open();
    }, true);
  }
}

class ImageLightboxModal extends Modal {
  constructor(app: App, private src: string, private alt: string) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass('zen-lightbox-modal');
    const img = this.contentEl.createEl('img', { attr: { src: this.src, alt: this.alt } });
    img.addEventListener('click', () => {
      this.modalEl.toggleClass('is-natural-size', !this.modalEl.hasClass('is-natural-size'));
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
