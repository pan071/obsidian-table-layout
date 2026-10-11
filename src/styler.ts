/**
 * 样式渲染：为页面上的表格分配编号、匹配样式记录，并把生成的 CSS 写入统一的样式表
 *
 * @author 启年
 * @createTime 2026-10-11 15:14
 */
import { debounce } from "obsidian";
import { buildTableCss } from "./css";
import { TABLE_SELECTOR, TableLocation, TableLocator } from "./locator";
import { TableStore } from "./store";
import { TableRecord, ViewKind, WidthConfig } from "./types";

/**
 * 页面上一个表格与其样式记录的绑定关系
 */
export interface TableBinding {
	/** 渲染编号，对应 data-tl-id */
	id: number;
	/** 表格元素 */
	table: HTMLTableElement;
	/** 表格直接容器（实时预览为 .table-wrapper，阅读视图为所在区块） */
	host: HTMLElement;
	/** 定位结果 */
	location: TableLocation;
	/** 样式记录 */
	record: TableRecord | null;
}

/**
 * 表格样式渲染器
 *
 * @author 启年
 * @createTime 2026-10-11 15:14
 */
export class TableStyler {
	/** 表格定位器 */
	private readonly locator: TableLocator;
	/** 样式存储 */
	private readonly store: TableStore;
	/** 当前页面上已绑定的表格 */
	private readonly bindings = new Map<HTMLTableElement, TableBinding>();
	/** 表格元素的渲染编号，同一元素编号不变 */
	private readonly ids = new WeakMap<HTMLTableElement, number>();
	/** 下一个可用编号 */
	private nextId = 1;
	/** 插件统一使用的样式表 */
	private styleEl: HTMLStyleElement | null = null;
	/** 拖动过程中的临时列宽 */
	private preview: { table: HTMLTableElement; width: WidthConfig } | null = null;
	/** 延迟刷新，用于编辑过程中表格序号变化等不涉及表格增删的场景 */
	readonly scheduleRefresh = debounce(() => this.refresh(), 150, false);

	/**
	 * 创建渲染器
	 *
	 * @param locator 表格定位器
	 * @param store 样式存储
	 */
	constructor(locator: TableLocator, store: TableStore) {
		this.locator = locator;
		this.store = store;
	}

	/**
	 * 挂载样式表并立即渲染
	 */
	start(): void {
		this.styleEl = document.head.createEl("style", { attr: { id: "table-layout-dynamic" } });
		this.refresh();
	}

	/**
	 * 卸载样式表并清理表格上的标记
	 */
	stop(): void {
		this.scheduleRefresh.cancel();
		this.styleEl?.remove();
		this.styleEl = null;
		for (const binding of this.bindings.values()) {
			this.clearMarks(binding.table, binding.host);
		}
		this.bindings.clear();
	}

	/**
	 * 重新绑定页面上的全部表格并更新样式表
	 */
	refresh(): void {
		if (!this.styleEl) {
			return;
		}
		const seen = new Set<HTMLTableElement>();
		const css: string[] = [];
		document.querySelectorAll<HTMLTableElement>(TABLE_SELECTOR).forEach((table) => {
			const binding = this.bind(table);
			if (!binding) {
				return;
			}
			seen.add(table);
			const preview = this.preview?.table === table ? this.preview.width : undefined;
			css.push(buildTableCss(binding.id, binding.location.kind, binding.record, preview));
		});
		// 移除已离开页面的表格
		for (const table of Array.from(this.bindings.keys())) {
			if (!seen.has(table)) {
				this.bindings.delete(table);
			}
		}
		// 内容不变时不写入，避免触发样式重算
		const text = css.filter((part) => part).join("\n");
		if (this.styleEl.textContent !== text) {
			this.styleEl.textContent = text;
		}
	}

	/**
	 * 获取表格的最新绑定（重新定位并匹配样式记录）
	 *
	 * @param table 表格元素
	 * @return 绑定关系，无法定位时返回 null
	 */
	getBinding(table: HTMLTableElement): TableBinding | null {
		return this.bind(table);
	}

	/**
	 * 获取已缓存的绑定，不重新定位，供鼠标悬停等高频场景使用
	 *
	 * @param table 表格元素
	 * @return 绑定关系
	 */
	peekBinding(table: HTMLTableElement): TableBinding | null {
		return this.bindings.get(table) ?? null;
	}

	/**
	 * 遍历当前页面上的全部绑定
	 *
	 * @return 绑定列表
	 */
	allBindings(): TableBinding[] {
		return Array.from(this.bindings.values());
	}

	/**
	 * 设置或清除拖动过程中的临时列宽
	 *
	 * @param table 表格元素
	 * @param width 临时列宽，null 表示清除
	 * @param render 是否立即重新渲染
	 */
	setPreview(table: HTMLTableElement, width: WidthConfig | null, render = true): void {
		this.preview = width ? { table, width } : null;
		if (render) {
			this.refresh();
		}
	}

	/**
	 * 定位表格并写入编号、模式标记
	 *
	 * @param table 表格元素
	 * @return 绑定关系，无法定位时返回 null
	 */
	private bind(table: HTMLTableElement): TableBinding | null {
		const host = table.parentElement;
		const location = host ? this.locator.locate(table) : null;
		if (!host || !location) {
			this.bindings.delete(table);
			if (host) {
				this.clearMarks(table, host);
			}
			return null;
		}
		const record = this.store.find(location.path, location.tables, location.index);

		// region 写入编号与模式标记
		let id = this.ids.get(table);
		if (id === undefined) {
			id = this.nextId++;
			this.ids.set(table, id);
		}
		setData(table, "tlId", `${id}`);
		setData(host, "tlHost", `${id}`);
		// 有列宽配置（含拖动中）时标记模式，全局默认铺满的样式据此跳过
		const width = this.preview?.table === table ? this.preview.width : record?.width;
		setData(table, "tlMode", width?.mode);
		setData(host, "tlMode", width?.mode);
		// endregion

		const binding: TableBinding = { id, table, host, location, record };
		this.bindings.set(table, binding);
		return binding;
	}

	/**
	 * 清除表格与容器上的插件标记
	 *
	 * @param table 表格元素
	 * @param host 表格容器
	 */
	private clearMarks(table: HTMLElement, host: HTMLElement): void {
		setData(table, "tlId", undefined);
		setData(table, "tlMode", undefined);
		setData(host, "tlHost", undefined);
		setData(host, "tlMode", undefined);
	}
}

/**
 * 写入或删除 data 属性，值不变时不操作
 *
 * @param el 元素
 * @param key dataset 键名
 * @param value 属性值，undefined 表示删除
 */
function setData(el: HTMLElement, key: string, value: string | undefined): void {
	if (value === undefined) {
		if (key in el.dataset) {
			delete el.dataset[key];
		}
		return;
	}
	if (el.dataset[key] !== value) {
		el.dataset[key] = value;
	}
}

/**
 * 判断表格是否位于实时预览中
 *
 * @param binding 绑定关系
 * @return 实时预览时返回 true
 */
export function isLivePreview(binding: TableBinding): boolean {
	return binding.location.kind === ViewKind.LivePreview;
}
