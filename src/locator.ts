/**
 * 表格定位：把页面上的表格元素换算为「文件路径 + 文件内第几个表格」
 *
 * @author 启年
 * @createTime 2026-10-11 15:14
 */
import { Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { App, editorInfoField, MarkdownPostProcessorContext, MarkdownView } from "obsidian";
import { findTableIndex, ParsedTable, parseTables } from "./parser";
import { ViewKind } from "./types";

/**
 * 表格定位结果
 */
export interface TableLocation {
	/** 视图类型 */
	kind: ViewKind;
	/** 文件路径 */
	path: string;
	/** 文件中的全部表格 */
	tables: ParsedTable[];
	/** 当前表格序号 */
	index: number;
}

/** 实时预览中的表格选择器 */
const LIVE_PREVIEW_TABLE = ".markdown-source-view .cm-table-widget > .table-wrapper > table";
/** 阅读视图（含悬浮预览）中的表格选择器 */
const READING_TABLE = ".markdown-preview-view table";
/** 页面上所有可能处理的表格 */
export const TABLE_SELECTOR = `${LIVE_PREVIEW_TABLE}, ${READING_TABLE}`;

/**
 * 表格定位器，缓存解析结果，避免每次渲染重复解析全文
 *
 * @author 启年
 * @createTime 2026-10-11 15:14
 */
export class TableLocator {
	/** Obsidian 应用实例 */
	private readonly app: App;
	/** 阅读视图表格对应的后处理上下文与所在区块 */
	private readonly readingContexts = new WeakMap<HTMLTableElement, { ctx: MarkdownPostProcessorContext; sectionEl: HTMLElement }>();
	/** 实时预览按文档对象缓存解析结果（文档对象不可变，内容变化即换新对象） */
	private readonly docCache = new WeakMap<Text, ParsedTable[]>();
	/** 阅读视图按全文缓存最近一次解析结果 */
	private textCache: { text: string; tables: ParsedTable[] } | null = null;

	/**
	 * 创建定位器
	 *
	 * @param app Obsidian 应用实例
	 */
	constructor(app: App) {
		this.app = app;
	}

	/**
	 * 登记阅读视图中渲染出的表格，供之后定位使用
	 *
	 * @param sectionEl 后处理器收到的区块元素
	 * @param ctx 后处理上下文
	 */
	registerReadingSection(sectionEl: HTMLElement, ctx: MarkdownPostProcessorContext): void {
		// 只登记区块的直接子表格，Callout、引用块中的表格不处理
		sectionEl.querySelectorAll<HTMLTableElement>(":scope > table").forEach((table) => {
			this.readingContexts.set(table, { ctx, sectionEl });
		});
	}

	/**
	 * 定位表格
	 *
	 * @param table 表格元素
	 * @return 定位结果，无法定位时返回 null
	 */
	locate(table: HTMLTableElement): TableLocation | null {
		try {
			// 实时预览表格位于表格编辑挂件中
			if (table.parentElement?.parentElement?.classList.contains("cm-table-widget")) {
				return this.locateLivePreview(table);
			}
			return this.locateReading(table);
		} catch (error) {
			// 定位失败（如挂件已卸载）时不处理该表格
			console.debug("[table-layout] 表格定位失败", error);
			return null;
		}
	}

	/**
	 * 定位实时预览中的表格
	 *
	 * @param table 表格元素
	 * @return 定位结果
	 */
	private locateLivePreview(table: HTMLTableElement): TableLocation | null {
		const widget = table.closest<HTMLElement>(".cm-table-widget");
		// 挂件外层最近的编辑器才是笔记编辑器（单元格内部也有编辑器）
		const editorEl = widget?.parentElement?.closest<HTMLElement>(".cm-editor");
		if (!widget || !editorEl) {
			return null;
		}
		const view = EditorView.findFromDOM(editorEl);
		const file = view?.state.field(editorInfoField, false)?.file;
		if (!view || !file) {
			return null;
		}
		// 挂件在文档中的位置即表格起始位置
		const doc = view.state.doc;
		const line = doc.lineAt(view.posAtDOM(widget)).number - 1;
		let tables = this.docCache.get(doc);
		if (!tables) {
			tables = parseTables(doc.toString());
			this.docCache.set(doc, tables);
		}
		const index = findTableIndex(tables, line);
		return index >= 0 ? { kind: ViewKind.LivePreview, path: file.path, tables, index } : null;
	}

	/**
	 * 定位阅读视图中的表格
	 *
	 * @param table 表格元素
	 * @return 定位结果
	 */
	private locateReading(table: HTMLTableElement): TableLocation | null {
		const entry = this.readingContexts.get(table);
		if (!entry) {
			return null;
		}
		// 区块信息在调用时实时计算，前面的内容变化后行号仍准确
		const info = entry.ctx.getSectionInfo(entry.sectionEl);
		if (!info) {
			return null;
		}
		const path = entry.ctx.sourcePath;
		let tables = this.parseText(info.text);
		let index = findTableIndex(tables, info.lineStart);
		// 区块信息只含局部文本时，退回所在视图的全文
		if (index < 0) {
			const text = this.findViewText(table, path);
			if (text === null) {
				return null;
			}
			tables = this.parseText(text);
			index = findTableIndex(tables, info.lineStart);
		}
		return index >= 0 ? { kind: ViewKind.Reading, path, tables, index } : null;
	}

	/**
	 * 解析全文，内容未变化时复用上次结果
	 *
	 * @param text 笔记全文
	 * @return 表格列表
	 */
	private parseText(text: string): ParsedTable[] {
		if (this.textCache?.text !== text) {
			this.textCache = { text, tables: parseTables(text) };
		}
		return this.textCache.tables;
	}

	/**
	 * 取表格所在 Markdown 视图的全文
	 *
	 * @param table 表格元素
	 * @param path 文件路径
	 * @return 全文，找不到对应视图时返回 null
	 */
	private findViewText(table: HTMLTableElement, path: string): string | null {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file?.path === path && view.containerEl.contains(table)) {
				return view.data;
			}
		}
		return null;
	}
}
