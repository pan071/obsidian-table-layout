/**
 * 表格样式存储：按文件保存表格样式记录，负责记录与当前表格的匹配、增删行列后的重映射以及样式修改
 *
 * @author 启年
 * @createTime 2026-10-11 15:14
 */
import { ParsedTable } from "./parser";
import {
	AlignProp,
	AlignRule,
	AlignScope,
	HorizontalAlign,
	TableLayoutData,
	TablePosition,
	TableRecord,
	VerticalAlign,
	WidthConfig,
	WidthMode,
} from "./types";

/**
 * 对齐规则的目标区域
 */
export interface AlignTarget {
	/** 作用范围 */
	scope: AlignScope;
	/** 行号（0 为表头行） */
	row?: number;
	/** 列号（从 0 开始） */
	col?: number;
}

/**
 * 表格样式存储，所有修改都会触发变更回调并延迟保存
 *
 * @author 启年
 * @createTime 2026-10-11 15:14
 */
export class TableStore {
	/** 插件持久化数据 */
	readonly data: TableLayoutData;
	/** 保存数据（由插件提供，已做防抖） */
	private readonly persist: () => void;
	/** 样式变更回调，用于触发重新渲染 */
	onChange: () => void = () => undefined;

	/**
	 * 创建存储
	 *
	 * @param data 已加载的持久化数据
	 * @param persist 保存数据的方法
	 */
	constructor(data: TableLayoutData, persist: () => void) {
		this.data = data;
		this.persist = persist;
	}

	// region 记录匹配

	/**
	 * 查找当前表格对应的样式记录，必要时按表头和行首单元格重映射后回写
	 *
	 * @param path 文件路径
	 * @param tables 文件中的全部表格
	 * @param index 当前表格序号
	 * @return 样式记录，没有时返回 null
	 */
	find(path: string, tables: ParsedTable[], index: number): TableRecord | null {
		const records = this.data.files[path];
		const parsed = tables[index];
		if (!records?.length || !parsed) {
			return null;
		}
		// 1、序号和表头都一致
		let record = records.find((r) => r.index === index && sameArray(r.header, parsed.header)) ?? null;
		// 2、表格整体移动：取表头相同、且原位置已不是它的记录中序号最近的一条
		if (!record) {
			const orphans = records.filter((r) => sameArray(r.header, parsed.header) && !this.isInPlace(r, tables));
			orphans.sort((a, b) => Math.abs(a.index - index) - Math.abs(b.index - index));
			record = orphans[0] ?? null;
		}
		// 3、表头被修改或增删列：同序号且表头相似
		if (!record) {
			const byIndex = records.find((r) => r.index === index);
			if (byIndex && similarHeader(byIndex.header, parsed.header)) {
				record = byIndex;
			}
		}
		if (record) {
			this.sync(record, index, parsed);
		}
		return record;
	}

	/**
	 * 查找样式记录，没有时新建
	 *
	 * @param path 文件路径
	 * @param tables 文件中的全部表格
	 * @param index 当前表格序号
	 * @return 样式记录
	 */
	ensure(path: string, tables: ParsedTable[], index: number): TableRecord {
		const existing = this.find(path, tables, index);
		if (existing) {
			return existing;
		}
		const parsed = tables[index];
		const record: TableRecord = {
			index,
			header: [...parsed.header],
			rowKeys: [...parsed.rowKeys],
			rules: [],
			seq: 1,
		};
		// 按文件分组保存
		(this.data.files[path] ??= []).push(record);
		return record;
	}

	/**
	 * 判断记录是否仍对应原序号上的表格
	 *
	 * @param record 样式记录
	 * @param tables 文件中的全部表格
	 * @return 原序号上的表格表头一致时返回 true
	 */
	private isInPlace(record: TableRecord, tables: ParsedTable[]): boolean {
		const table = tables[record.index];
		return !!table && sameArray(table.header, record.header);
	}

	/**
	 * 把记录同步到当前表格：更新序号，并按表头和行首单元格重映射列宽与对齐规则
	 *
	 * @param record 样式记录
	 * @param index 当前表格序号
	 * @param parsed 当前表格
	 */
	private sync(record: TableRecord, index: number, parsed: ParsedTable): void {
		let changed = record.index !== index;
		record.index = index;

		// region 列重映射
		if (!sameArray(record.header, parsed.header)) {
			const colMap = remap(record.header, parsed.header);
			record.rules = record.rules.flatMap((rule) => {
				if (rule.col === undefined) {
					return [rule];
				}
				const col = colMap[rule.col];
				return col >= 0 ? [{ ...rule, col }] : [];
			});
			if (record.width) {
				record.width = remapWidth(record.width, colMap, parsed.header.length);
			}
			record.header = [...parsed.header];
			changed = true;
		}
		// endregion

		// region 行重映射（规则中的行号 0 为表头，数据行从 1 开始）
		if (!sameArray(record.rowKeys, parsed.rowKeys)) {
			const rowMap = remap(record.rowKeys, parsed.rowKeys);
			record.rules = record.rules.flatMap((rule) => {
				if (rule.row === undefined || rule.row === 0) {
					return [rule];
				}
				const row = rowMap[rule.row - 1];
				return row >= 0 ? [{ ...rule, row: row + 1 }] : [];
			});
			record.rowKeys = [...parsed.rowKeys];
			changed = true;
		}
		// endregion

		if (changed) {
			this.persist();
		}
	}

	// endregion

	// region 样式修改

	/**
	 * 设置对齐：先移除目标区域内同属性的旧规则，再追加新规则
	 *
	 * @param record 样式记录
	 * @param target 目标区域
	 * @param prop 对齐属性
	 * @param value 对齐值
	 */
	setAlign(record: TableRecord, target: AlignTarget, prop: AlignProp, value: HorizontalAlign | VerticalAlign): void {
		record.rules = record.rules.filter((rule) => !(rule.prop === prop && covers(target, rule)));
		record.rules.push({ scope: target.scope, row: target.row, col: target.col, prop, value, seq: record.seq++ });
		this.commit();
	}

	/**
	 * 清除目标区域内的全部对齐规则
	 *
	 * @param path 文件路径
	 * @param record 样式记录
	 * @param target 目标区域
	 */
	clearAlign(path: string, record: TableRecord, target: AlignTarget): void {
		record.rules = record.rules.filter((rule) => !covers(target, rule));
		this.removeIfEmpty(path, record);
		this.commit();
	}

	/**
	 * 设置列宽，传入 undefined 表示恢复默认布局
	 *
	 * @param path 文件路径
	 * @param record 样式记录
	 * @param width 列宽配置
	 */
	setWidth(path: string, record: TableRecord, width: WidthConfig | undefined): void {
		record.width = width;
		this.removeIfEmpty(path, record);
		this.commit();
	}

	/**
	 * 设置表格在页面中的位置
	 *
	 * @param record 样式记录
	 * @param position 表格位置
	 */
	setPosition(record: TableRecord, position: TablePosition): void {
		record.position = position;
		this.commit();
	}

	/**
	 * 删除表格的全部样式
	 *
	 * @param path 文件路径
	 * @param record 样式记录
	 */
	reset(path: string, record: TableRecord): void {
		const records = this.data.files[path];
		if (records) {
			this.data.files[path] = records.filter((r) => r !== record);
			this.removeEmptyFile(path);
		}
		this.commit();
	}

	// endregion

	// region 文件变化

	/**
	 * 文件重命名或移动时迁移记录
	 *
	 * @param oldPath 原路径
	 * @param newPath 新路径
	 */
	renameFile(oldPath: string, newPath: string): void {
		const records = this.data.files[oldPath];
		if (!records) {
			return;
		}
		this.data.files[newPath] = records;
		delete this.data.files[oldPath];
		this.persist();
	}

	/**
	 * 文件删除时清理记录
	 *
	 * @param path 文件路径
	 */
	deleteFile(path: string): void {
		if (!this.data.files[path]) {
			return;
		}
		delete this.data.files[path];
		this.persist();
	}

	// endregion

	/**
	 * 保存并通知重新渲染
	 */
	private commit(): void {
		this.persist();
		this.onChange();
	}

	/**
	 * 记录不再包含任何样式时删除
	 *
	 * @param path 文件路径
	 * @param record 样式记录
	 */
	private removeIfEmpty(path: string, record: TableRecord): void {
		if (record.rules.length > 0 || record.width || record.position) {
			return;
		}
		const records = this.data.files[path];
		if (records) {
			this.data.files[path] = records.filter((r) => r !== record);
			this.removeEmptyFile(path);
		}
	}

	/**
	 * 文件下没有记录时删除该文件分组
	 *
	 * @param path 文件路径
	 */
	private removeEmptyFile(path: string): void {
		if (this.data.files[path]?.length === 0) {
			delete this.data.files[path];
		}
	}
}

// region 工具函数

/**
 * 判断两个字符串数组是否完全相同
 *
 * @param a 数组一
 * @param b 数组二
 * @return 长度和每一项都相同时返回 true
 */
function sameArray(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((item, i) => item === b[i]);
}

/**
 * 判断表头是否相似：列数相同，或至少一半的列名仍然存在
 *
 * @param oldHeader 原表头
 * @param newHeader 当前表头
 * @return 相似时返回 true
 */
function similarHeader(oldHeader: string[], newHeader: string[]): boolean {
	if (oldHeader.length === newHeader.length) {
		return true;
	}
	const shared = oldHeader.filter((name) => newHeader.includes(name)).length;
	return shared * 2 >= Math.max(oldHeader.length, newHeader.length);
}

/**
 * 计算旧序号到新序号的映射：同位置同名优先，其次取最近的同名项，数量不变时保留原位置
 *
 * @param oldKeys 原各项文本
 * @param newKeys 当前各项文本
 * @return 下标为旧序号、值为新序号的数组，-1 表示已被删除
 */
export function remap(oldKeys: string[], newKeys: string[]): number[] {
	const map: number[] = new Array<number>(oldKeys.length).fill(-1);
	const used = new Set<number>();
	// 1、同位置同名
	oldKeys.forEach((key, i) => {
		if (i < newKeys.length && newKeys[i] === key) {
			map[i] = i;
			used.add(i);
		}
	});
	// 2、最近的同名项
	oldKeys.forEach((key, i) => {
		if (map[i] >= 0) {
			return;
		}
		let best = -1;
		newKeys.forEach((newKey, j) => {
			if (newKey === key && !used.has(j) && (best < 0 || Math.abs(j - i) < Math.abs(best - i))) {
				best = j;
			}
		});
		if (best >= 0) {
			map[i] = best;
			used.add(best);
		}
	});
	// 3、数量不变时视为原位置内容被修改
	if (oldKeys.length === newKeys.length) {
		oldKeys.forEach((_, i) => {
			if (map[i] < 0 && !used.has(i)) {
				map[i] = i;
				used.add(i);
			}
		});
	}
	return map;
}

/**
 * 按列映射重排列宽，新增列取已有列的平均宽度
 *
 * @param width 原列宽配置
 * @param colMap 列映射
 * @param colCount 当前列数
 * @return 重排后的列宽配置，无法推算时返回 undefined
 */
function remapWidth(width: WidthConfig, colMap: number[], colCount: number): WidthConfig | undefined {
	const values: (number | undefined)[] = new Array<number | undefined>(colCount).fill(undefined);
	colMap.forEach((col, i) => {
		if (col >= 0 && width.values[i] !== undefined) {
			values[col] = width.values[i];
		}
	});
	const known = values.filter((v): v is number => v !== undefined);
	// 没有任何一列能对应上时放弃原列宽
	if (known.length === 0) {
		return undefined;
	}
	const average = known.reduce((sum, v) => sum + v, 0) / known.length;
	const filled = values.map((v) => v ?? average);
	// 铺满模式下重新归一化比例
	if (width.mode === WidthMode.Fill) {
		const total = filled.reduce((sum, v) => sum + v, 0);
		return { mode: width.mode, values: filled.map((v) => v / total) };
	}
	return { mode: width.mode, values: filled };
}

/**
 * 判断规则所作用的区域是否完全落在目标区域内
 *
 * @param target 目标区域
 * @param rule 对齐规则
 * @return 被目标区域覆盖时返回 true
 */
function covers(target: AlignTarget, rule: AlignRule): boolean {
	switch (target.scope) {
		case AlignScope.Table:
			return true;
		case AlignScope.Row:
			return (rule.scope === AlignScope.Row || rule.scope === AlignScope.Cell) && rule.row === target.row;
		case AlignScope.Column:
			return (rule.scope === AlignScope.Column || rule.scope === AlignScope.Cell) && rule.col === target.col;
		case AlignScope.Cell:
			return rule.scope === AlignScope.Cell && rule.row === target.row && rule.col === target.col;
	}
}

// endregion
