// api/storage.js (Supabase版)
import { createClient } from '@supabase/supabase-js';

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
 * @returns {Promise<{names: Array, specialDays: Array, workdayAvailability: Array, submissions: Array, confirmedShifts: Object, counters: Object}>}
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
            workdayAvailability: workdayAvailability || [],
            submissions: submissions || [],
            confirmedShifts: deserializeConfirmedShifts(confirmedShifts || []),
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
 * @param {{names: Array, specialDays: Array, workdayAvailability: Array, submissions: Array, confirmedShifts: Object}} payload
 * @returns {Promise<void>}
 */
async function write(payload) {
    console.log('Writing data to Supabase...');
        const { names, specialDays, workdayAvailability, submissions, confirmedShifts } = payload;

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

        if (fetchSubmissionsError || fetchConfirmedError || fetchSpecialDaysError || fetchNamesError || fetchWorkdayAvailabilityError) {
            console.error(
                'Supabase fetch error:',
                fetchSubmissionsError || fetchConfirmedError || fetchSpecialDaysError || fetchNamesError || fetchWorkdayAvailabilityError
            );
            throw new Error('Failed to fetch existing data before diff sync.');
        }

        await syncTableWithDiff({
            tableName: 'submissions',
            nextRows: normalizedSubmissions,
            currentRows: currentSubmissions || [],
            keyFn: (row) => row.id,
            compareKeys: ['name', 'date', 'monthKey', 'shiftType', 'start', 'end']
        });

        await syncTableWithDiff({
            tableName: 'confirmed_shifts',
            nextRows: confirmedShiftRows,
            currentRows: currentConfirmedShifts || [],
            keyFn: (row) => `${row.date}|${row.name}|${row.shiftType}`,
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

        await syncTableWithDiff({
            tableName: 'workday_availability',
            nextRows: normalizedWorkdayAvailability,
            currentRows: currentWorkdayAvailability || [],
            keyFn: (row) => row.date,
            compareKeys: ['isAvailable'],
            onConflictKey: 'date',
            deleteKey: 'date'
        });

        console.log('Data successfully written to Supabase.');

    } catch (error) {
        console.error('Error during Supabase write operation:', error.message);
        throw new Error('Database write failed.');
    }
}

async function syncTableWithDiff({
    tableName,
    nextRows,
    currentRows,
    keyFn,
    compareKeys,
    allowIdReuse = false,
    onConflictKey = 'id',
    deleteKey = 'id'
}) {
    const { rowsToUpsert, idsToDelete } = computeDiff({
        nextRows,
        currentRows,
        keyFn,
        compareKeys,
        allowIdReuse,
        deleteKey
    });

    if (idsToDelete.length) {
        const { error: deleteError } = await supabase.from(tableName).delete().in(deleteKey, idsToDelete);
        if (deleteError) throw deleteError;
    }

    if (rowsToUpsert.length) {
        const { error: upsertError } = await supabase
            .from(tableName)
            .upsert(rowsToUpsert, { onConflict: onConflictKey });
        if (upsertError) throw upsertError;
    }
}

function computeDiff({ nextRows, currentRows, keyFn, compareKeys, allowIdReuse, deleteKey }) {
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
        .map((row) => row[deleteKey])
        .filter((id) => id !== undefined && id !== null);

    return { rowsToUpsert, idsToDelete };
}

function areRowsEqual(a, b, keys) {
    return keys.every((key) => normalizeValue(a?.[key]) === normalizeValue(b?.[key]));
}

function normalizeValue(value) {
    return value === undefined ? null : value;
}

function serializeConfirmedShifts(confirmedShifts) {
    return Object.entries(confirmedShifts || {}).flatMap(([, entries]) => {
        if (!entries || typeof entries !== 'object') return [];
        return Object.entries(entries)
            .filter(([, isConfirmed]) => Boolean(isConfirmed))
            .map(([entryKey]) => {
                const parsed = parseConfirmedEntryKey(entryKey);
                const shiftType = parsed.shiftType || parsed.slot || null;

                if (!parsed.name || !parsed.date || !shiftType) {
                    return null;
                }

                return {
                    name: parsed.name,
                    date: parsed.date,
                    shiftType,
                    start: parsed.start || null,
                    end: parsed.end || null,
                    note: parsed.label || null
                };
            })
            .filter(Boolean);
    });
}

function deserializeConfirmedShifts(rows) {
    return (rows || []).reduce((acc, row) => {
        const monthKey = deriveMonthKey(row.date);
        const entryKey = buildEntryKeyFromRow(row);
        if (!monthKey || !entryKey) return acc;
        if (!acc[monthKey]) {
            acc[monthKey] = {};
        }
        acc[monthKey][entryKey] = true;
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

function buildEntryKeyFromRow(row) {
    if (!row) return null;
    const date = row.date || '';
    const name = row.name || '';
    const shiftType = row.shiftType || '';
    const slot = shiftType || '';
    const label = row.note || row.name || '';
    const start = row.start || '';
    const end = row.end || '';
    if (!date || !slot || !name) {
        return null;
    }
    return [date, slot, name, label, start, end, shiftType].join('|');
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
    return (entries || []).reduce((acc, entry) => {
        if (!entry || typeof entry !== 'object') return acc;
        if (typeof entry.date !== 'string') return acc;
        acc.push({
            date: entry.date,
            isAvailable: entry.isAvailable !== false
        });
        return acc;
    }, []);
}

// --- 既存の API インターフェースに合わせて createStorage 関数を定義 ---
export function createStorage(dataFilePath) {
    // dataFilePath は Supabase では使用しませんが、既存の関数シグネチャを維持
    return {
        read,
        write
    };
}
