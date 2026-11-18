import { Notice, Plugin, TFile, normalizePath } from 'obsidian';

/** 日记根目录（vault 内） */
const DIARY_ROOT = '个人/日记与回忆/日记';

const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Zen 日记模块
 * 固化快捷键 Option+Shift+D：
 *  - 路径：日记根目录/YYYY/YYYY-MM/YYYY-MM-DD Weekday 日记.md（与既有日记结构一致）
 *  - 年/月文件夹不存在则自动创建；已存在则直接打开
 */
export class ZenDiaryFeature {
  constructor(private plugin: Plugin) {}

  private get app() {
    return this.plugin.app;
  }

  load(): void {
    this.plugin.addCommand({
      id: 'open-daily-diary',
      name: '新建/打开今日日记',
      hotkeys: [{ modifiers: ['Alt', 'Shift'], key: 'd' }],
      callback: () => {
        void this.openTodayDiary();
      },
    });
  }

  async openTodayDiary(): Promise<TFile> {
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const date = `${yyyy}-${mm}-${dd}`;
    const weekday = WEEKDAYS_EN[now.getDay()];

    const dir = `${DIARY_ROOT}/${yyyy}/${yyyy}-${mm}`;
    const path = normalizePath(`${dir}/${date} ${weekday} 日记.md`);

    let file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      await this.ensureFolder(dir);
      file = await this.app.vault.create(path, this.buildTemplate(now, date, weekday));
      new Notice(`✅ 已创建今日日记：${date}`);
    } else {
      new Notice(`📖 打开今日日记：${date}`);
    }

    await this.app.workspace.getLeaf(false).openFile(file as TFile);
    return file as TFile;
  }

  /** 与既有日记保持一致的模板 */
  private buildTemplate(now: Date, date: string, weekday: string): string {
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    return `---

---

>[!info]
>
>   不杀生 不偷盗 不邪淫 不妄语 不喝酒

---
### 0.1 时间切片


${date} ${hh}:${min} , ${weekday}



#日记
`;
  }

  /** 逐级创建文件夹（已存在则跳过） */
  private async ensureFolder(dir: string): Promise<void> {
    let current = '';
    for (const part of dir.split('/')) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }
}
