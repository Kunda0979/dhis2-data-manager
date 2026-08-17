/**
 * Auto-paginate DHIS2 tracker API responses.
 * Returns an array of all items across all pages.
 *
 * @param {AxiosInstance} client
 * @param {string} endpoint
 * @param {object} params - base query params (will add page/pageSize)
 * @param {string} dataKey - key in response body that holds the array ('instances' or similar)
 * @param {number} pageSize
 */
async function paginateEach(client, endpoint, params = {}, dataKey = 'instances', pageSize = 100, options = {}, onPage = async () => {}) {
  let page = 1;
  let hasMore = true;
  const maxRows = options.maxRows;
  const maxRowsErrorFactory = options.maxRowsErrorFactory;
  let totalCount = 0;

  while (hasMore) {
    const response = await client.get(endpoint, {
      params: { ...params, page, pageSize },
    });

    const data = response.data;
    const items = data[dataKey] || data.trackedEntities || data.enrollments || data.events || [];

    totalCount += items.length;

    if (maxRows && totalCount > maxRows) {
      const err = typeof maxRowsErrorFactory === 'function'
        ? maxRowsErrorFactory()
        : new Error(`Export exceeds the configured row limit of ${maxRows}.`);
      if (!err.status) {
        err.status = 413;
      }
      throw err;
    }

    await onPage(items, {
      page,
      totalCount,
      pageSize,
    });

    // DHIS2 v42 pager
    const pager = data.pager;
    if (pager) {
      hasMore = page < pager.pageCount;
    } else {
      hasMore = items.length === pageSize;
    }
    page++;
  }

  return totalCount;
}

async function paginate(client, endpoint, params = {}, dataKey = 'instances', pageSize = 100, options = {}) {
  const allItems = [];

  await paginateEach(client, endpoint, params, dataKey, pageSize, options, async (items) => {
    allItems.push(...items);
  });

  return allItems;
}

module.exports = { paginate, paginateEach };
