import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchAllRows } from './supabase-pagination.js';

function createFakeClient(sourceRows) {
    const calls = [];

    return {
        calls,
        from(tableName) {
            const query = {
                select() {
                    return query;
                },
                order(column, options) {
                    calls.push({ type: 'order', tableName, column, options });
                    return query;
                },
                async range(from, to) {
                    calls.push({ type: 'range', tableName, from, to });
                    return { data: sourceRows.slice(from, to + 1), error: null };
                }
            };
            return query;
        }
    };
}

test('fetchAllRows continues after the Supabase 1000-row boundary', async () => {
    const sourceRows = Array.from({ length: 1005 }, (_, index) => ({ id: index + 1 }));
    const client = createFakeClient(sourceRows);

    const result = await fetchAllRows(client, 'submissions');

    assert.equal(result.error, null);
    assert.equal(result.data.length, 1005);
    assert.deepEqual(
        client.calls.filter((call) => call.type === 'range'),
        [
            { type: 'range', tableName: 'submissions', from: 0, to: 999 },
            { type: 'range', tableName: 'submissions', from: 1000, to: 1999 }
        ]
    );
});

test('fetchAllRows uses a stable configured order column', async () => {
    const client = createFakeClient([{ date: '2026-09-01' }]);

    await fetchAllRows(client, 'workday_availability', { orderColumn: 'date' });

    assert.deepEqual(client.calls[0], {
        type: 'order',
        tableName: 'workday_availability',
        column: 'date',
        options: { ascending: true }
    });
});
