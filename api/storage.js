// api/storage.js (Supabase版)
import { createClient } from '@supabase/supabase-js';

const CONFIRMED_SHIFT_NOTE_PREFIX = '__confirmed_meta__:';

// --- Supabase クライアントの初期化 ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('FATAL: Supabase environment variables (SUPABASE_URL or SUPABASE_SERVICE_KEY) are not set.');
    // 接続情報がない場合はエラーをスローし、APIの起動をブロックします
    throw new Error('Supabase client initialization failed due to missing environment variables.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Supabaseからデータを読み込み、既存のペイロード形式に整形して返します。
 * @returns {Promise<{names: Array, specialDays: Array, submissions: Array, confirmedShifts: Object, workdayAvailability: Array, counters: Object}>}
 */
async function read() {
    console.log('Reading data from Supabase...');
    try {
        // 1. 全テーブルからデータを並行して取得
        const [
            { data: names, error: namesError },
            { data: specialDays, error: specialDaysError },
            { data: submissions, error: submissionsError },
            { data: confirmedShifts, error: confirmedError },
            { data: workdayAvailability, error: workdayAvailabilityError }
        ] = await Promise.all([
            supabase.from('names').select('*'),
            supabase.from('special_days').select('*'),
            supabase.from('submissions').select('*'),
            supabase.from('confirmed_shifts').select('*'),
            supabase.from('workday_availability').select('*')
        ]);

        // エラーチェック
        if (namesError || specialDaysError || submissionsError || confirmedError || workdayAvailabilityError) {
            console.error(
                'Supabase read error:',
                namesError || specialDaysError || submissionsError || confirmedError || workdayAvailabilityError
            );
            throw new Error('Database query failed.');
        }

        // 2. 既存のペイロード形式に整形
        // 注意: counters は自動採番に任せるため空のオブジェクトで返します
        const payload = {
            names: names || [],
            specialDays: specialDays || [],
            submissions: submissions || [],
            confirmedShifts: deserializeConfirmedShifts(confirmedShifts || []),
            workdayAvailability: normalizeWorkdayAvailability(workdayAvailability),
            // カウンターは Supabase の自動採番 (serial PK) に任せるため不要
            counters: {}
        };

        return payload;

    } catch (error) {
        console.error('Error during Supabase read operation:', error.message);
        throw error;
    }
}

/**
 * ペイロードの内容をSupabaseの各テーブルに反映します。
 * 既存データとの差分のみを反映し、全削除を避けることで不要な書き込みを減らします。
 * @param {{names: Array, specialDays: Array, submissions: Array, submissionSyncScopes?: Array, confirmedShifts: Object, workdayAvailability: Array}} payload
 * @returns {Promise<void>}
 */
async function write(payload) {
    console.log('Writing data to Supabase...');
    const {
        names,
        specialDays,
        submissions,
        submissionSyncScopes,
        confirmedShifts,
        workdayAvailability
    } = payload;

    try {
        const normalizedSubmissions = normalizeSubmissionsForInsert(submissions);
        const normalizedSpecialDays = normalizeListWithIds(specialDays);
        const normalizedNames = normalizeListWithIds(names);
        const confirmedShiftRows = serializeConfirmedShifts(confirmedShifts || {});
        const normalizedWorkdayAvailability = normalizeWorkdayAvailability(workdayAvailability);

        const [
            { data: currentSubmissions, error: fetchSubmissionsError },
            { data: currentConfirmedShifts, error: fetchConfirmedError },
            { data: currentSpecialDays, error: fetchSpecialDaysError },
            { data: currentNames, error: fetchNamesError },
            { data: currentWorkdayAvailability, error: fetchWorkdayAvailabilityError }
        ] = await Promise.all([
            supabase.from('submissions').select('*'),
            supabase.from('confirmed_shifts').select('*'),
            supabase.from('special_days').select('*'),
            supabase.from('names').select('*'),
            supabase.from('workday_availability').select('*')
        ]);

        if (
            fetchSubmissionsError ||
            fetchConfirmedError ||
            fetchSpecialDaysError ||
            fetchNamesError ||
            fetchWorkdayAvailabilityError
        ) {
            console.error(
                'Supabase fetch error:',
                fetchSubmissionsError ||
                fetchConfirmedError ||
                fetchSpecialDaysError ||
                fetchNamesError ||
                fetchWorkdayAvailabilityError
            );
            throw new Error('Failed to fetch existing data before diff sync.');
        }

        await syncSubmissionsWithDiff({
            nextRows: normalizedSubmissions,
            currentRows: currentSubmissions || [],
            scopes: submissionSyncScopes
        });

        await syncTableWithDiff({
            tableName: 'confirmed_shifts',
            nextRows: confirmedShiftRows,
            currentRows: currentConfirmedShifts || [],
            keyFn: buildConfirmedShiftStorageKey,
            compareKeys: ['start', 'end', 'note'],
            allowIdReuse: true
        });

        await syncTableWithDiff({
            tableName: 'special_days',
            nextRows: normalizedSpecialDays,
            currentRows: currentSpecialDays || [],
            keyFn: (row) => row.id,
            compareKeys: ['date', 'note']
        });

        await syncTableWithDiff({
            tableName: 'names',
            nextRows: normalizedNames,
            currentRows: currentNames || [],
            keyFn: (row) => row.id,
            compareKeys: ['name']
        });

        await syncWorkdayAvailabilityWithDiff({
            nextRows: normalizedWorkdayAvailability,
            currentRows: currentWorkdayAvailability || []
        });

        console.log('Data successfully written to Supabase.');

    } catch (error) {
        console.error('Error during Supabase write operation:', error.message);
        throw new Error('Database write failed.');
    }
}

async function deleteRowsByColumn({ tableName, columnName, values }) {
    const filteredValues = Array.from(
        new Set((values || []).filter((value) => value !== undefined && value !== null))
    );

    if (!filteredValues.length) {
        return { deletedCount: 0 };
    }

    const { error } = await supabase
        .from(tableName)
        .delete()
        .in(columnName, filteredValues);

    if (error) {
        throw error;
    }

    return { deletedCount: filteredValues.length };
}

async function syncWorkdayAvailabilityWithDiff({ nextRows, currentRows }) {
    const currentMap = new Map(
        (currentRows || [])
            .filter((row) => typeof row?.date === 'string')
            .map((row) => [row.date, getAvailabilityValue(row)])
    );

    const nextMap = new Map(
        (nextRows || [])
            .filter((row) => typeof row?.date === 'string')
            .map((row) => [row.date, getAvailabilityValue(row)])
    );

    const rowsToUpsert = [];
    nextMap.forEach((isAvailable, date) => {
        if (!currentMap.has(date) || currentMap.get(date) !== isAvailable) {
            rowsToUpsert.push({ date, isavailable: isAvailable });
        }
    });

    const staleDates = Array.from(currentMap.keys()).filter((date) => !nextMap.has(date));

    if (staleDates.length) {
        console.warn(
            `[non-destructive-sync] Skipping delete for workday_availability. stale rows=${staleDates.length}`
        );
    }

    if (rowsToUpsert.length) {
        const { error: upsertError } = await supabase
            .from('workday_availability')
            .upsert(rowsToUpsert, { onConflict: 'date' });
        if (upsertError) throw upsertError;
    }
}

async function syncSubmissionsWithDiff({ nextRows, currentRows, scopes }) {
    const normalizedScopes = normalizeSubmissionSyncScopes(scopes);

    if (!normalizedScopes.length) {
        await syncTableWithDiff({
            tableName: 'submissions',
            nextRows,
            currentRows,
            keyFn: (row) => row.id,
            compareKeys: ['name', 'date', 'monthKey', 'shiftType', 'start', 'end']
        });
        return;
    }

    const scopeKeys = new Set(
        normalizedScopes.map((scope) => buildSubmissionScopeKey(scope.name, scope.monthKey))
    );
    const isInScope = (row) => scopeKeys.has(buildSubmissionScopeKey(row?.name, row?.monthKey));

    const scopedNextRows = (nextRows || []).filter(isInScope);
    const scopedCurrentRows = (currentRows || []).filter(isInScope);
    const outOfScopeNextRows = (nextRows || []).filter((row) => !isInScope(row));
    const outOfScopeCurrentRows = (currentRows || []).filter((row) => !isInScope(row));
    const duplicateScopedCurrentIds = findDuplicateRowIdsByKey(
        scopedCurrentRows,
        buildSubmissionNaturalKey
    );

    const scopedDiff = computeDiff({
        nextRows: dedupeRowsByKey(scopedNextRows, buildSubmissionNaturalKey),
        currentRows: dedupeRowsByKey(scopedCurrentRows, buildSubmissionNaturalKey),
        keyFn: buildSubmissionNaturalKey,
        compareKeys: ['shiftType', 'start', 'end'],
        allowIdReuse: true
    });

    const outOfScopeDiff = computeDiff({
        nextRows: outOfScopeNextRows,
        currentRows: outOfScopeCurrentRows,
        keyFn: (row) => row.id,
        compareKeys: ['name', 'date', 'monthKey', 'shiftType', 'start', 'end']
    });

    const scopedIdsToDelete = Array.from(
        new Set([...duplicateScopedCurrentIds, ...scopedDiff.idsToDelete])
    );

    if (scopedIdsToDelete.length) {
        await deleteRowsByColumn({
            tableName: 'submissions',
            columnName: 'id',
            values: scopedIdsToDelete
        });
    }

    if (outOfScopeDiff.idsToDelete.length) {
        console.warn(
            `[non-destructive-sync] Skipping delete for submissions outside scoped sync. stale rows=${outOfScopeDiff.idsToDelete.length}`
        );
    }

    const rowsToUpsert = [...outOfScopeDiff.rowsToUpsert, ...scopedDiff.rowsToUpsert];
    if (rowsToUpsert.length) {
        await syncRowsById({ tableName: 'submissions', rows: rowsToUpsert });
    }
}

async function syncTableWithDiff({
    tableName,
    nextRows,
    currentRows,
    keyFn,
    compareKeys,
    allowIdReuse = false
}) {
    const { rowsToUpsert, idsToDelete } = computeDiff({
        nextRows,
        currentRows,
        keyFn,
        compareKeys,
        allowIdReuse
    });

    if (idsToDelete.length) {
        console.warn(
            `[non-destructive-sync] Skipping delete for ${tableName}. stale rows=${idsToDelete.length}`
        );
    }

    if (rowsToUpsert.length) {
        await syncRowsById({ tableName, rows: rowsToUpsert });
    }
}

async function syncRowsById({ tableName, rows }) {
    const rowsWithId = [];
    const rowsWithoutId = [];

    (rows || []).forEach((row) => {
        if (hasValidId(row?.id)) {
            rowsWithId.push(row);
            return;
        }

        rowsWithoutId.push(stripIdField(row));
    });

    if (rowsWithId.length) {
        const { error: upsertError } = await supabase
            .from(tableName)
            .upsert(rowsWithId, { onConflict: 'id' });
        if (upsertError) throw upsertError;
    }

    if (rowsWithoutId.length) {
        const { error: insertError } = await supabase
            .from(tableName)
            .insert(rowsWithoutId);
        if (insertError) throw insertError;
    }
}

function computeDiff({ nextRows, currentRows, keyFn, compareKeys, allowIdReuse }) {
    const currentMap = new Map();
    (currentRows || []).forEach((row) => {
        const key = keyFn(row);
        if (key !== undefined && key !== null) {
            currentMap.set(key, row);
        }
    });

    const seenKeys = new Set();
    const rowsToUpsert = [];

    (nextRows || []).forEach((row) => {
        const key = keyFn(row);
        if (key === undefined || key === null) return;
        seenKeys.add(key);

        const existing = currentMap.get(key);
        const preparedRow = { ...row };

        if (existing && allowIdReuse && existing.id && !preparedRow.id) {
            preparedRow.id = existing.id;
        }

        const hasDiff = existing
            ? !areRowsEqual(existing, preparedRow, compareKeys)
            : true;

        if (hasDiff) {
            rowsToUpsert.push(preparedRow);
        }
    });

    const idsToDelete = (currentRows || [])
        .filter((row) => !seenKeys.has(keyFn(row)))
        .map((row) => row.id)
        .filter((id) => id !== undefined && id !== null);

    return { rowsToUpsert, idsToDelete };
}

function areRowsEqual(a, b, keys) {
    return keys.every((key) => normalizeValue(a?.[key]) === normalizeValue(b?.[key]));
}

function normalizeValue(value) {
    return value === undefined ? null : value;
}

function hasValidId(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0;
}

function stripIdField(row) {
    if (!row || typeof row !== 'object') {
        return row;
    }

    const { id, ...rest } = row;
    return rest;
}

function normalizeSubmissionSyncScopes(scopes) {
    const uniqueScopes = new Map();

    (scopes || []).forEach((scope) => {
        const name = typeof scope?.name === 'string' ? scope.name : '';
        const monthKey = typeof scope?.monthKey === 'string' ? scope.monthKey : '';
        const key = buildSubmissionScopeKey(name, monthKey);

        if (!key) {
            return;
        }

        uniqueScopes.set(key, { name, monthKey });
    });

    return Array.from(uniqueScopes.values());
}

function buildSubmissionScopeKey(name, monthKey) {
    if (!name || !monthKey) {
        return '';
    }

    return `${name}|${monthKey}`;
}

function buildSubmissionNaturalKey(row) {
    if (
        !row ||
        typeof row.name !== 'string' ||
        typeof row.monthKey !== 'string' ||
        typeof row.date !== 'string'
    ) {
        return null;
    }

    return `${row.name}|${row.monthKey}|${row.date}`;
}

function dedupeRowsByKey(rows, keyFn) {
    const deduped = new Map();

    (rows || []).forEach((row) => {
        const key = keyFn(row);
        if (key === undefined || key === null) {
            return;
        }

        if (!deduped.has(key)) {
            deduped.set(key, row);
        }
    });

    return Array.from(deduped.values());
}

function findDuplicateRowIdsByKey(rows, keyFn) {
    const seen = new Set();
    const duplicateIds = [];

    (rows || []).forEach((row) => {
        const key = keyFn(row);
        if (key === undefined || key === null) {
            return;
        }

        if (seen.has(key)) {
            if (row?.id !== undefined && row?.id !== null) {
                duplicateIds.push(row.id);
            }
            return;
        }

        seen.add(key);
    });

    return duplicateIds;
}

function serializeConfirmedShifts(confirmedShifts) {
    const groupedRows = new Map();

    Object.entries(confirmedShifts || {}).forEach(([, entries]) => {
        if (!entries || typeof entries !== 'object') return;

        Object.entries(entries)
            .filter(([, isConfirmed]) => Boolean(isConfirmed))
            .forEach(([entryKey]) => {
                const parsed = parseConfirmedEntryKey(entryKey);
                const shiftType = parsed.shiftType || parsed.slot || null;
                const slot = parsed.slot || null;

                if (!parsed.name || !parsed.date || !shiftType || !slot) {
                    return;
                }

                const row = {
                    name: parsed.name,
                    date: parsed.date,
                    shiftType,
                    start: parsed.start || null,
                    end: parsed.end || null
                };
                const storageKey = buildConfirmedShiftStorageKey(row);

                if (!storageKey) {
                    return;
                }

                const existing = groupedRows.get(storageKey) || {
                    ...row,
                    slotLabels: {}
                };

                existing.slotLabels[slot] = parsed.label || parsed.name || '';
                groupedRows.set(storageKey, existing);
            });
    });

    return Array.from(groupedRows.values()).map((row) => ({
        name: row.name,
        date: row.date,
        shiftType: row.shiftType,
        start: row.start,
        end: row.end,
        note: encodeConfirmedShiftNote({
            slotLabels: row.slotLabels
        })
    }));
}

function deserializeConfirmedShifts(rows) {
    return (rows || []).reduce((acc, row) => {
        const monthKey = deriveMonthKey(row.date);
        const entryKeys = buildEntryKeysFromRow(row);
        if (!monthKey || !entryKeys.length) return acc;
        if (!acc[monthKey]) {
            acc[monthKey] = {};
        }
        entryKeys.forEach((entryKey) => {
            acc[monthKey][entryKey] = true;
        });
        return acc;
    }, {});
}

function deriveMonthKey(dateString) {
    if (!dateString || typeof dateString !== 'string') return null;
    const [year, month] = dateString.split('-');
    if (!year || !month) return null;
    return `${year}-${month}`;
}

function parseConfirmedEntryKey(entryKey) {
    if (!entryKey || typeof entryKey !== 'string') {
        return {};
    }
    const [date, slot, name, label, start, end, shiftType] = entryKey.split('|');
    return { date, slot, name, label, start, end, shiftType };
}

function buildEntryKeysFromRow(row) {
    if (!row) return [];
    const meta = decodeConfirmedShiftNote(row.note);
    const date = row.date || '';
    const name = row.name || '';
    const shiftType = row.shiftType || '';
    const start = row.start || '';
    const end = row.end || '';
    if (!date || !name || !shiftType) {
        return [];
    }

    const slotLabels = getConfirmedShiftSlotLabels(meta);
    if (slotLabels.length) {
        return slotLabels.map(({ slot, label }) =>
            [date, slot, name, label || row.name || '', start, end, shiftType].join('|')
        );
    }

    const fallbackSlot = shiftType || '';
    const fallbackLabel =
        typeof row.note === 'string' && !row.note.startsWith(CONFIRMED_SHIFT_NOTE_PREFIX)
            ? row.note
            : row.name || '';

    if (!fallbackSlot) {
        return [];
    }

    return [[date, fallbackSlot, name, fallbackLabel, start, end, shiftType].join('|')];
}

function buildConfirmedShiftStorageKey(row) {
    if (!row) {
        return null;
    }

    const date = row.date || '';
    const name = row.name || '';
    const shiftType = row.shiftType || '';
    const start = normalizeValue(row.start) ?? '';
    const end = normalizeValue(row.end) ?? '';

    if (!date || !name || !shiftType) {
        return null;
    }

    return [date, name, shiftType, start, end].join('|');
}

function encodeConfirmedShiftNote({ slotLabels }) {
    const payload = {
        slots: buildStableConfirmedShiftSlots(slotLabels)
    };
    return `${CONFIRMED_SHIFT_NOTE_PREFIX}${JSON.stringify(payload)}`;
}

function decodeConfirmedShiftNote(note) {
    if (typeof note !== 'string' || !note.startsWith(CONFIRMED_SHIFT_NOTE_PREFIX)) {
        return null;
    }

    try {
        const parsed = JSON.parse(note.slice(CONFIRMED_SHIFT_NOTE_PREFIX.length));
        if (parsed?.slots && typeof parsed.slots === 'object') {
            return {
                slots: buildStableConfirmedShiftSlots(parsed.slots)
            };
        }

        if (typeof parsed?.slot === 'string') {
            return {
                slots: buildStableConfirmedShiftSlots({
                    [parsed.slot]: typeof parsed?.label === 'string' ? parsed.label : ''
                })
            };
        }

        return null;
    } catch (error) {
        console.warn('Failed to parse confirmed shift note metadata', error);
        return null;
    }
}

function getConfirmedShiftSlotLabels(meta) {
    if (!meta?.slots || typeof meta.slots !== 'object') {
        return [];
    }

    return Object.entries(meta.slots)
        .filter(([slot]) => typeof slot === 'string' && slot)
        .map(([slot, label]) => ({
            slot,
            label: typeof label === 'string' ? label : ''
        }));
}

function buildStableConfirmedShiftSlots(slotLabels) {
    const source = slotLabels && typeof slotLabels === 'object' ? slotLabels : {};
    const slots = {};
    const orderedKeys = ['morning', 'afternoon'];
    const extraKeys = Object.keys(source)
        .filter((key) => !orderedKeys.includes(key))
        .sort((a, b) => a.localeCompare(b));

    [...orderedKeys, ...extraKeys].forEach((slot) => {
        const label = source[slot];
        if (typeof label === 'string' && slot) {
            slots[slot] = label;
        }
    });

    return slots;
}

function normalizeListWithIds(entries) {
    let nextId = 1;
    return (entries || []).reduce((acc, entry) => {
        if (!entry || typeof entry !== 'object') return acc;

        const parsedId = Number(entry.id);
        const id = Number.isFinite(parsedId) && parsedId > 0 ? parsedId : nextId++;
        nextId = Math.max(nextId, id + 1);

        acc.push({ ...entry, id });
        return acc;
    }, []);
}

function normalizeSubmissionsForInsert(entries) {
    let nextId = 1;
    return (entries || []).reduce((acc, entry) => {
        if (!entry || typeof entry !== 'object') return acc;

        const hasRequiredFields =
            typeof entry.name === 'string' &&
            typeof entry.date === 'string' &&
            typeof entry.monthKey === 'string' &&
            typeof entry.shiftType === 'string';

        if (!hasRequiredFields) return acc;

        const parsedId = Number(entry.id);
        const id = Number.isFinite(parsedId) && parsedId > 0 ? parsedId : nextId++;
        nextId = Math.max(nextId, id + 1);

        acc.push({
            id,
            name: entry.name,
            date: entry.date,
            monthKey: entry.monthKey,
            shiftType: entry.shiftType,
            start: entry.start ?? null,
            end: entry.end ?? null
        });
        return acc;
    }, []);
}

function normalizeWorkdayAvailability(entries) {
    const byDate = new Map();
    (entries || []).forEach((entry) => {
        if (!entry || typeof entry.date !== 'string') return;
        byDate.set(entry.date, {
            date: entry.date,
            isAvailable: getAvailabilityValue(entry)
        });
    });
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function getAvailabilityValue(entry) {
    if (!entry || typeof entry !== 'object') return false;
    if ('isAvailable' in entry) return Boolean(entry.isAvailable);
    if ('isavailable' in entry) return Boolean(entry.isavailable);
    if ('is_available' in entry) return Boolean(entry.is_available);
    return false;
}

// --- 既存の API インターフェースに合わせて createStorage 関数を定義 ---
export function createStorage(dataFilePath) {
    // dataFilePath は Supabase では使用しませんが、既存の関数シグネチャを維持
    return {
        read,
        write,
        deleteRowsByColumn
    };
}
