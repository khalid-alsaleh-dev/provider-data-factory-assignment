export const location = () => ({ domain: 'talabat', statusCode: 200, updatedAt: new Date('2026-09-14T00:00:00Z'), payload: { results: [
  { location_id: 1468, location_name: ' Al   Zaab ', location_slug: 'al-zaab' },
  { location_id: '1468', location_name: ' Al   Zaab ', location_slug: 'al-zaab' },
] } });
export const listing = () => ({ domain: 'talabat', statusCode: 200, updatedAt: new Date('2026-09-14T00:00:00Z'), params: { areaId: '1468' }, payload: { results: [
  { restaurant_name: 'Listing name', restaurant_url: 'https://www.talabat.com/uae/restaurant/123/example?aid=1468' },
] } });
export const menu = () => ({ domain: 'talabat', statusCode: 200, updatedAt: new Date('2026-07-22T00:00:00Z'), params: { restaurant_url: 'https://www.talabat.com/uae/restaurant/123/another-slug?aid=1468' }, payload: { results: [
  { id: 9999, name: 'Full restaurant', latitude: '25.23', longitude: '55.31', outletCode: 123, category: [
    { category_id: 10, category_name: 'Recommended', items: [{ item_id: 20, item_name: ' Pad Thai ', price: '57.25', description: ' Good\r\nfood ' }] },
    { category_id: 11, category_name: 'Noodles', items: [{ item_id: '20', item_name: ' Pad Thai ', price: 57.25, description: ' Good\r\nfood ' }] },
  ] },
] } });
