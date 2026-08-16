const DEFAULT_PAGE_SIZE = 1000;

export async function fetchAllRows(
    client,
    tableName,
    { orderColumn = 'id', pageSize = DEFAULT_PAGE_SIZE } = {}
) {
    const rows = [];
    let from = 0;

    while (true) {
        const to = from + pageSize - 1;
        const { data, error } = await client
            .from(tableName)
            .select('*')
            .order(orderColumn, { ascending: true })
            .range(from, to);

        if (error) {
            return { data: null, error };
        }

        const page = Array.isArray(data) ? data : [];
        rows.push(...page);

        if (page.length < pageSize) {
            return { data: rows, error: null };
        }

        from += pageSize;
    }
}
