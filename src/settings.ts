/**
 * 插件设置页：默认铺满、最小列宽与自适应列宽上限
 *
 * @author 启年
 * @createTime 2026-10-11 15:14
 */
import { App, PluginSettingTab, Setting } from "obsidian";
import type TableLayoutPlugin from "./main";
import { DEFAULT_SETTINGS } from "./types";

/**
 * 插件设置页，修改后立即保存并重新渲染表格
 *
 * @author 启年
 * @createTime 2026-10-11 15:14
 */
export class TableLayoutSettingTab extends PluginSettingTab {
	/** 插件实例 */
	private readonly plugin: TableLayoutPlugin;

	/**
	 * 创建设置页
	 *
	 * @param app Obsidian 应用实例
	 * @param plugin 插件实例
	 */
	constructor(app: App, plugin: TableLayoutPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * 渲染设置页
	 */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// region 默认铺满
		new Setting(containerEl)
			.setName("默认铺满页面宽度")
			.setDesc("未调整过列宽的表格自动撑满页面宽度；关闭后保持 Obsidian 默认的按内容宽度显示。")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.fillByDefault).onChange(async (value) => {
					this.plugin.settings.fillByDefault = value;
					await this.plugin.saveSettings();
				}),
			);
		// endregion

		// region 列宽限制
		this.addNumberSetting("最小列宽（像素）", "拖动和自适应时单列不会小于该宽度。", "minColumnWidth", 10);
		this.addNumberSetting("自适应列宽上限（像素）", "双击列边框按内容自适应时，单列不会超过该宽度，避免长文本把表格撑得过宽。", "autoFitMaxWidth", 50);
		// endregion

		// region 使用说明
		const usage = containerEl.createEl("ul");
		for (const line of [
			"拖动列边框：与右侧相邻列互相让出宽度，表格总宽不变。",
			"拖动最后一列右边框或按住 Shift 拖动：只改当前列，表格可变窄（按表格位置对齐）或超宽（横向滚动）；总宽接近页面宽度时自动吸附为铺满。",
			"双击列边框：该列按最长内容自适应宽度。",
			"右键单元格 →「表格布局」：设置单元格、行、列、整表的水平/垂直对齐，表格位置，铺满页面与整表自适应。",
		]) {
			usage.createEl("li", { text: line });
		}
		// endregion
	}

	/**
	 * 添加一个数字输入设置项
	 *
	 * @param name 名称
	 * @param desc 描述
	 * @param key 设置键名
	 * @param min 允许的最小值
	 */
	private addNumberSetting(name: string, desc: string, key: "minColumnWidth" | "autoFitMaxWidth", min: number): void {
		new Setting(this.containerEl)
			.setName(name)
			.setDesc(desc)
			.addText((text) =>
				text
					.setPlaceholder(`${DEFAULT_SETTINGS[key]}`)
					.setValue(`${this.plugin.settings[key]}`)
					.onChange(async (value) => {
						const parsed = Number.parseInt(value, 10);
						// 非法输入或低于下限时不保存
						if (Number.isNaN(parsed) || parsed < min) {
							return;
						}
						this.plugin.settings[key] = parsed;
						await this.plugin.saveSettings();
					}),
			);
	}
}
