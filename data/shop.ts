// Demo shop data: products, customers and orders. Dates are relative to "now" so refund windows stay realistic.

export const PRODUCTS: [sku: string, name: string, category: string, price: number, stock: number][] = [
  ['BED-001', 'Organic Cotton Duvet Cover - Double', 'Bedding', 45.0, 120],
  ['BED-002', 'Organic Cotton Duvet Cover - King', 'Bedding', 55.0, 80],
  ['BED-003', 'Linen Pillowcase Pair - Sage', 'Bedding', 28.0, 200],
  ['BED-004', 'Hotel Collection Pillow (Pair)', 'Bedding', 35.0, 60],
  ['BED-005', 'Waffle Knit Throw - Oatmeal', 'Bedding', 39.0, 45],
  ['KIT-001', 'Stoneware Dinner Set - 12 Piece', 'Kitchen', 89.0, 30],
  ['KIT-002', 'Hand-Painted Ceramic Mug - Fern', 'Kitchen', 14.0, 300],
  ['KIT-003', 'Electric Kettle 1.7L - Cream', 'Kitchen', 49.0, 70],
  ['KIT-004', '2-Slice Toaster - Cream', 'Kitchen', 39.0, 65],
  ['KIT-005', 'Oak Chopping Board - Large', 'Kitchen', 32.0, 90],
  ['KIT-006', 'Cast Iron Casserole 4L - Teal', 'Kitchen', 119.0, 25],
  ['LGT-001', 'Rattan Pendant Shade', 'Lighting', 49.0, 40],
  ['LGT-002', 'Brass Table Lamp', 'Lighting', 79.0, 35],
  ['LGT-003', 'Arc Floor Lamp - Black', 'Lighting', 149.0, 12],
  ['LGT-004', 'LED Fairy Lights - 10m', 'Lighting', 18.0, 250],
  ['FUR-001', 'Solid Oak Side Table', 'Furniture', 129.0, 15],
  ['FUR-002', 'Velvet Accent Chair - Mustard', 'Furniture', 249.0, 8],
  ['FUR-003', 'Bamboo Bathroom Shelf', 'Furniture', 59.0, 22],
  ['FUR-004', 'Oak Bookcase - 5 Shelf', 'Furniture', 299.0, 6],
  ['FRG-001', 'Fig and Cedar Scented Candle', 'Fragrance', 24.0, 180],
  ['FRG-002', 'Reed Diffuser - Sea Salt', 'Fragrance', 22.0, 140],
  ['FRG-003', 'Wax Melts Gift Set', 'Fragrance', 16.0, 0],
  ['HEA-001', 'Oil-Filled Radiator Heater 2kW', 'Appliances', 69.0, 20],
  ['HEA-002', 'Quiet Desk Fan', 'Appliances', 34.0, 0],
  ['GFT-010', 'Digital Gift Card £25', 'Gift cards', 25.0, 9999],
];

export const CUSTOMERS: { name: string; email: string; tier: string; notes?: string }[] = [
  { name: 'Emma Clarke', email: 'emma.clarke@example.co.uk', tier: 'plus' },
  { name: 'James Patel', email: 'james.patel@example.co.uk', tier: 'standard' },
  { name: 'Sophie Williams', email: 'sophie.w@example.co.uk', tier: 'standard', notes: 'Prefers email contact.' },
  { name: 'Oliver Hughes', email: 'oliver.hughes@example.co.uk', tier: 'plus' },
  { name: 'Amelia Jones', email: 'amelia.jones@example.co.uk', tier: 'standard', notes: 'Had a lost parcel in March, refunded.' },
  { name: 'Harry Thompson', email: 'harry.t@example.co.uk', tier: 'standard' },
  { name: 'Isla Murray', email: 'isla.murray@example.co.uk', tier: 'standard' },
  { name: 'Mohammed Khan', email: 'm.khan@example.co.uk', tier: 'plus' },
  { name: 'Grace Evans', email: 'grace.evans@example.co.uk', tier: 'standard' },
  { name: 'Noah Robinson', email: 'noah.r@example.co.uk', tier: 'standard' },
];

// [orderId, customerIndex, status, items [sku, qty], daysAgoCreated, daysAgoDelivered|null, carrier]
export const ORDERS: [string, number, string, [string, number][], number, number | null, string | null][] = [
  ['BB-10401', 0, 'delivered', [['BED-001', 1], ['BED-003', 1]], 12, 9, 'Royal Mail'],
  ['BB-10402', 0, 'shipped', [['KIT-003', 1]], 3, null, 'Royal Mail'],
  ['BB-10403', 1, 'processing', [['LGT-002', 1], ['LGT-004', 2]], 0, null, null],
  ['BB-10404', 1, 'delivered', [['KIT-001', 1]], 50, 46, 'DPD'],
  ['BB-10405', 2, 'delivered', [['FUR-002', 1]], 10, 6, 'DPD'],
  ['BB-10406', 2, 'shipped', [['FRG-001', 2], ['FRG-002', 1]], 4, null, 'Royal Mail'],
  ['BB-10407', 3, 'delivered', [['LGT-003', 1]], 20, 17, 'DPD'],
  ['BB-10408', 3, 'processing', [['KIT-006', 1]], 1, null, null],
  ['BB-10409', 4, 'shipped', [['BED-002', 1], ['BED-004', 1]], 9, null, 'Royal Mail'],
  ['BB-10410', 4, 'delivered', [['KIT-002', 4]], 25, 22, 'Royal Mail'],
  ['BB-10411', 5, 'delivered', [['FUR-004', 1]], 15, 11, 'DPD'],
  ['BB-10412', 5, 'cancelled', [['HEA-002', 1]], 30, null, null],
  ['BB-10413', 6, 'delivered', [['KIT-004', 1]], 7, 4, 'Royal Mail'],
  ['BB-10414', 6, 'processing', [['BED-005', 1], ['FRG-001', 1]], 0, null, null],
  ['BB-10415', 7, 'delivered', [['FUR-001', 1], ['LGT-001', 1]], 35, 31, 'DPD'],
  ['BB-10416', 7, 'shipped', [['HEA-001', 1]], 2, null, 'DPD'],
  ['BB-10417', 8, 'delivered', [['BED-003', 2]], 5, 2, 'Royal Mail'],
  ['BB-10418', 8, 'refunded', [['KIT-005', 1]], 40, 37, 'Royal Mail'],
  ['BB-10419', 9, 'delivered', [['FUR-003', 1], ['KIT-002', 2]], 18, 15, 'Royal Mail'],
  ['BB-10420', 9, 'processing', [['GFT-010', 1]], 0, null, null],
];

export const ADDRESSES = [
  '12 Albert Road, Manchester, M14 5QR', '7 Station Street, Leeds, LS1 4HY', '33 Clifton Road, Bristol, BS8 1AF',
  '5 Kings Avenue, Edinburgh, EH4 2LN', '81 Park Lane, Liverpool, L1 8JQ', '19 Elm Grove, Sheffield, S10 1BX',
  '2 Harbour View, Inverness, IV1 1EZ', '44 Victoria Road, Birmingham, B21 0RA', '9 Abbey Close, Cardiff, CF10 3AT',
  '27 Queen Street, Belfast, BT1 6EB',
];
