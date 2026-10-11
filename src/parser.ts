/**
 * Markdown 表格解析：从笔记原文中找出所有顶层表格的位置、表头与行首单元格
 *
 * @author 启年
 * @createTime 2026-10-11 15:14
 */

/**
 * 解析出的单个表格
 */
export interface ParsedTable {
	/** 表头所在行（从 0 开始） */
	startLine: number;
	/** 表格最后一行（从 0 开始） */
	endLine: number;
	/** 表头各单元格原文 */
	header: string[];
	/** 每个数据行首个单元格原文 */
	rowKeys: string[];
}

/** 分隔行：由 `-`、`:`、`|` 和空白组成，且每段至少一个 `-` */
const DELIMITER_ROW = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
/** 代码块围栏起始行 */
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/**
 * 按未转义的竖线拆分表格行
 *
 * @param line 表格行原文
 * @return 去除首尾空白后的各单元格原文
 */
export function splitRow(line: string): string[] {
	let text = line.trim();
	// 去掉行首竖线
	if (text.startsWith("|")) {
		text = text.slice(1);
	}
	// 去掉行尾未转义的竖线
	if (text.endsWith("|") && !text.endsWith("\\|")) {
		text = text.slice(0, -1);
	}
	const cells: string[] = [];
	let current = "";
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		// 转义字符连同下一个字符原样保留
		if (ch === "\\" && i + 1 < text.length) {
			current += ch + text[i + 1];
			i++;
			continue;
		}
		if (ch === "|") {
			cells.push(current.trim());
			current = "";
			continue;
		}
		current += ch;
	}
	cells.push(current.trim());
	return cells;
}

/**
 * 解析笔记中的所有顶层表格（跳过 frontmatter、代码块与引用块/Callout 内的表格）
 *
 * @param text 笔记全文
 * @return 按出现顺序排列的表格
 */
export function parseTables(text: string): ParsedTable[] {
	const lines = text.split("\n");
	const tables: ParsedTable[] = [];
	let i = 0;

	// region 跳过 frontmatter
	if (lines[0]?.trim() === "---") {
		for (let j = 1; j < lines.length; j++) {
			if (lines[j].trim() === "---") {
				i = j + 1;
				break;
			}
		}
	}
	// endregion

	// 当前所在代码块的围栏，null 表示不在代码块内
	let fence: string | null = null;
	while (i < lines.length) {
		const line = lines[i];
		const fenceMatch = line.match(FENCE);

		// region 代码块内只寻找结束围栏
		if (fence !== null) {
			if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length && line.trim() === fenceMatch[1]) {
				fence = null;
			}
			i++;
			continue;
		}
		if (fenceMatch) {
			fence = fenceMatch[1];
			i++;
			continue;
		}
		// endregion

		// region 识别表头 + 分隔行
		const next = lines[i + 1];
		const isTableStart =
			next !== undefined &&
			line.includes("|") &&
			next.includes("|") &&
			!line.trimStart().startsWith(">") &&
			DELIMITER_ROW.test(next) &&
			splitRow(line).length === splitRow(next).length;
		if (!isTableStart) {
			i++;
			continue;
		}
		// endregion

		// region 收集数据行，遇到空行或非表格行结束
		const header = splitRow(line);
		const rowKeys: string[] = [];
		let end = i + 1;
		for (let j = i + 2; j < lines.length; j++) {
			const row = lines[j];
			if (row.trim() === "" || !row.includes("|") || row.trimStart().startsWith(">") || FENCE.test(row)) {
				break;
			}
			rowKeys.push(splitRow(row)[0] ?? "");
			end = j;
		}
		tables.push({ startLine: i, endLine: end, header, rowKeys });
		i = end + 1;
		// endregion
	}
	return tables;
}

/**
 * 找出指定行所在的表格序号
 *
 * @param tables 已解析的表格
 * @param line 行号（从 0 开始）
 * @return 表格序号，找不到时返回 -1
 */
export function findTableIndex(tables: ParsedTable[], line: number): number {
	// 优先精确匹配表头行
	const exact = tables.findIndex((table) => table.startLine === line);
	if (exact >= 0) {
		return exact;
	}
	return tables.findIndex((table) => table.startLine <= line && line <= table.endLine);
}
