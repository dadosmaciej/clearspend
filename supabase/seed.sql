-- Seed data for local development
-- Test user: test@clearspend.dev / test123456
-- Provides 3 receipts + 10 line items so S-02 UI can be built without S-01

INSERT INTO auth.users (
  id, instance_id, aud, role,
  email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'test@clearspend.dev',
  crypt('test123456', gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  false
) ON CONFLICT (id) DO NOTHING;

-- Receipt 1: Lidl grocery run
INSERT INTO receipts (id, user_id, shop_name, purchase_date, total_amount, processing_status, image_path)
VALUES (
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000001',
  'Lidl', '2026-05-20', 42.37, 'done',
  '00000000-0000-0000-0000-000000000001/receipt-lidl.jpg'
) ON CONFLICT (id) DO NOTHING;

-- Receipt 2: BP fuel stop
INSERT INTO receipts (id, user_id, shop_name, purchase_date, total_amount, processing_status, image_path)
VALUES (
  '00000000-0000-0000-0000-000000000102',
  '00000000-0000-0000-0000-000000000001',
  'BP Fuel', '2026-05-22', 78.50, 'done',
  '00000000-0000-0000-0000-000000000001/receipt-bp.jpg'
) ON CONFLICT (id) DO NOTHING;

-- Receipt 3: MediaMarkt electronics
INSERT INTO receipts (id, user_id, shop_name, purchase_date, total_amount, processing_status, image_path)
VALUES (
  '00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000001',
  'MediaMarkt', '2026-05-25', 129.99, 'done',
  '00000000-0000-0000-0000-000000000001/receipt-mediamarkt.jpg'
) ON CONFLICT (id) DO NOTHING;

-- Line items for Lidl (4 grocery items, positions 0-3)
INSERT INTO line_items (id, receipt_id, name, price, category, position) VALUES
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000101', 'Whole Milk 1L',    1.29, 'food', 0),
  ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000101', 'Sourdough Bread',  2.49, 'food', 1),
  ('00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000101', 'Chicken Breast 500g', 5.99, 'food', 2),
  ('00000000-0000-0000-0000-000000000204', '00000000-0000-0000-0000-000000000101', 'Orange Juice 1L',  1.79, 'food', 3)
ON CONFLICT (id) DO NOTHING;

-- Line items for BP (2 fuel items, positions 0-1)
INSERT INTO line_items (id, receipt_id, name, price, category, position) VALUES
  ('00000000-0000-0000-0000-000000000205', '00000000-0000-0000-0000-000000000102', 'Unleaded 95 - 40L', 72.00, 'fuel', 0),
  ('00000000-0000-0000-0000-000000000206', '00000000-0000-0000-0000-000000000102', 'Car Wash Basic',    6.50, 'fuel', 1)
ON CONFLICT (id) DO NOTHING;

-- Line items for MediaMarkt (4 electronics items, positions 0-3)
INSERT INTO line_items (id, receipt_id, name, price, category, position) VALUES
  ('00000000-0000-0000-0000-000000000207', '00000000-0000-0000-0000-000000000103', 'USB-C Cable 2m',    12.99, 'electronics', 0),
  ('00000000-0000-0000-0000-000000000208', '00000000-0000-0000-0000-000000000103', 'Screen Cleaner Kit', 8.99, 'electronics', 1),
  ('00000000-0000-0000-0000-000000000209', '00000000-0000-0000-0000-000000000103', 'Wireless Mouse',    39.99, 'electronics', 2),
  ('00000000-0000-0000-0000-000000000210', '00000000-0000-0000-0000-000000000103', 'HDMI Adapter',      18.99, 'electronics', 3)
ON CONFLICT (id) DO NOTHING;
