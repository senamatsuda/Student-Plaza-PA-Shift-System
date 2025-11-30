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
 * @returns {Promise<{names: Array, specialDays: Array, submissions: Array, counters: Object}>}
 */
async function read() {
    console.log('Reading data from Supabase...');
    try {
        // 1. 全テーブルからデータを並行して取得
        const [
            { data: names, error: namesError },
            { data: specialDays, error: specialDaysError },
            { data: submissions, error: submissionsError }
        ] = await Promise.all([
            supabase.from('names').select('*'),
            supabase.from('special_days').select('*'),
            supabase.from('submissions').select('*')
        ]);

        // エラーチェック
        if (namesError || specialDaysError || submissionsError) {
            console.error('Supabase read error:', namesError || specialDaysError || submissionsError);
            throw new Error('Database query failed.');
        }

        // 2. 既存のペイロード形式に整形
        // 注意: counters は自動採番に任せるため空のオブジェクトで返します
        const payload = {
            names: names || [],
            specialDays: specialDays || [],
            submissions: submissions || [],
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
 * 既存のデータを全て削除し、新しいデータを挿入するシンプルなロジックを採用します。
 * より複雑なシステムでは upsert やトランザクションを検討してください。
 * * @param {{names: Array, specialDays: Array, submissions: Array}} payload 
 * @returns {Promise<void>}
 */
async function write(payload) {
    console.log('Writing data to Supabase...');
    const { names, specialDays, submissions } = payload;

    try {
        // --- データの書き込み（シンプルな全削除＆全挿入戦略） ---
        
        // 1. submissions (シフト提出データ) の処理
        // 既存データを全て削除し、新しいデータを挿入
        const { error: deleteSubmissionsError } = await supabase.from('submissions').delete().neq('id', 0); // 全削除
        if (deleteSubmissionsError) throw deleteSubmissionsError;

        const { error: insertSubmissionsError } = await supabase.from('submissions').insert(submissions);
        if (insertSubmissionsError) throw insertSubmissionsError;
        
        // 2. special_days (特別日データ) の処理
        // 既存データを全て削除し、新しいデータを挿入
        const { error: deleteSpecialDaysError } = await supabase.from('special_days').delete().neq('id', 0); // 全削除
        if (deleteSpecialDaysError) throw deleteSpecialDaysError;
        
        const { error: insertSpecialDaysError } = await supabase.from('special_days').insert(specialDays);
        if (insertSpecialDaysError) throw insertSpecialDaysError;
        
        // 3. names (スタッフ名簿) の処理
        // 既存データを全て削除し、新しいデータを挿入
        const { error: deleteNamesError } = await supabase.from('names').delete().neq('id', 0); // 全削除
        if (deleteNamesError) throw deleteNamesError;
        
        const { error: insertNamesError } = await supabase.from('names').insert(names);
        if (insertNamesError) throw insertNamesError;

        console.log('Data successfully written to Supabase.');
        
    } catch (error) {
        console.error('Error during Supabase write operation:', error.message);
        throw new Error('Database write failed.');
    }
}

// --- 既存の API インターフェースに合わせて createStorage 関数を定義 ---
export function createStorage(dataFilePath) {
    // dataFilePath は Supabase では使用しませんが、既存の関数シグネチャを維持
    return {
        read,
        write
    };
}