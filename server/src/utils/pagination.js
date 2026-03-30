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
async function paginate(client, endpoint, params = {}, dataKey = 'instances', pageSize = 100) {
  const allItems = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const response = await client.get(endpoint, {
      params: { ...params, page, pageSize },
    });

    const data = response.data;
    const items = data[dataKey] || data.trackedEntities || data.enrollments || data.events || [];

    allItems.push(...items);

    // DHIS2 v42 pager
    const pager = data.pager;
    if (pager) {
      hasMore = page < pager.pageCount;
    } else {
      hasMore = items.length === pageSize;
    }
    page++;
  }

  return allItems;
}

module.exports = { paginate };
