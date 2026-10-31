import {
  boolean,
  bigint,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }),
  phone: varchar('phone', { length: 50 }),
  passwordHash: varchar('password_hash', { length: 255 }),
  role: varchar('role', { length: 50 }).default('member').notNull(),
  level: varchar('level', { length: 50 }),
  lineUserId: varchar('line_user_id', { length: 255 }),
  referralCode: varchar('referral_code', { length: 100 }),
  referrerId: integer('referrer_id'),
  referredByMemberId: integer('referred_by_member_id'),
  referralBoundAt: timestamp('referral_bound_at'),
  referralSource: varchar('referral_source', { length: 80 }),
  referralAttributionId: varchar('referral_attribution_id', { length: 120 }),
  referralVisitId: varchar('referral_visit_id', { length: 120 }),
  promotionQualificationStatus: varchar('promotion_qualification_status', { length: 40 }),
  promotionAppliedAt: timestamp('promotion_applied_at'),
  promotionApprovedAt: timestamp('promotion_approved_at'),
  promotionPolicyVersion: varchar('promotion_policy_version', { length: 80 }),
  promotionDisabledAt: timestamp('promotion_disabled_at'),
  promotionDisabledReason: text('promotion_disabled_reason'),
  agentLevel: integer('agent_level').default(0),
  agentStatus: varchar('agent_status', { length: 50 }),
  totalSalesVolume: numeric('total_sales').default('0'),
  commissionBalance: numeric('total_commission').default('0'),
  status: varchar('status', { length: 50 }).default('active'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const referralLinks = pgTable('referral_links', {
  id: serial('id').primaryKey(),
  linkId: varchar('link_id', { length: 100 }).notNull(),
  memberId: integer('member_id').references(() => users.id).notNull(),
  status: varchar('status', { length: 30 }).default('active').notNull(),
  revokedAt: timestamp('revoked_at'),
  revokedBy: integer('revoked_by').references(() => users.id),
  revokeReason: text('revoke_reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  linkIdUnique: uniqueIndex('referral_links_link_id_unique').on(table.linkId),
  memberStatusIndex: index('referral_links_member_status_idx').on(table.memberId, table.status),
}));

export const referralAttributionVisits = pgTable('referral_attribution_visits', {
  id: serial('id').primaryKey(),
  visitId: varchar('visit_id', { length: 120 }).notNull(),
  attributionId: varchar('attribution_id', { length: 120 }).notNull(),
  linkId: varchar('link_id', { length: 100 }).notNull(),
  referrerMemberId: integer('referrer_member_id').references(() => users.id).notNull(),
  sessionHash: varchar('session_hash', { length: 128 }).notNull(),
  sourcePath: text('source_path'),
  retainedExistingAttribution: boolean('retained_existing_attribution').default(false).notNull(),
  userAgentHash: varchar('user_agent_hash', { length: 128 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  visitIdUnique: uniqueIndex('referral_attribution_visits_visit_id_unique').on(table.visitId),
  attributionIndex: index('referral_attribution_visits_attribution_idx').on(table.attributionId),
}));

export const referralBindingAudit = pgTable('referral_binding_audit', {
  id: serial('id').primaryKey(),
  auditId: varchar('audit_id', { length: 120 }).notNull(),
  memberId: integer('member_id').references(() => users.id).notNull(),
  referredByMemberId: integer('referred_by_member_id').references(() => users.id).notNull(),
  linkId: varchar('link_id', { length: 100 }).notNull(),
  visitId: varchar('visit_id', { length: 120 }).notNull(),
  attributionId: varchar('attribution_id', { length: 120 }).notNull(),
  source: varchar('source', { length: 80 }).notNull(),
  result: varchar('result', { length: 40 }).notNull(),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  auditIdUnique: uniqueIndex('referral_binding_audit_audit_id_unique').on(table.auditId),
  memberIndex: index('referral_binding_audit_member_idx').on(table.memberId),
}));

export const promotionQualificationAudit = pgTable('promotion_qualification_audit', {
  id: serial('id').primaryKey(),
  auditId: varchar('audit_id', { length: 120 }).notNull(),
  memberId: integer('member_id').references(() => users.id).notNull(),
  actorId: integer('actor_id').references(() => users.id),
  action: varchar('action', { length: 80 }).notNull(),
  result: varchar('result', { length: 40 }).notNull(),
  reason: text('reason').notNull(),
  policyVersion: varchar('policy_version', { length: 80 }).notNull(),
  appliedAt: timestamp('applied_at'),
  approvedAt: timestamp('approved_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  auditIdUnique: uniqueIndex('promotion_qualification_audit_audit_id_unique').on(table.auditId),
  memberIndex: index('promotion_qualification_audit_member_idx').on(table.memberId),
}));

export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull(),
  description: text('description'),
  priceTwd: numeric('price').notNull(),
  originalPrice: numeric('original_price'),
  categoryId: integer('category_id'),
  supplierId: integer('supplier_id'),
  supplierName: varchar('supplier_name', { length: 255 }),
  images: jsonb('images'),
  stockQuantity: integer('stock').default(0),
  priceCny: numeric('price_cny'),
  costCny: numeric('cost_cny'),
  commissionRate: numeric('commission_rate'),
  reviewStatus: varchar('review_status', { length: 50 }),
  reviewNote: text('review_note'),
  reviewedAt: timestamp('reviewed_at'),
  reviewedBy: integer('reviewed_by'),
  submittedAt: timestamp('submitted_at'),
  isActive: boolean('is_active').default(true),
  isFeatured: boolean('is_featured').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  orderNo: varchar('order_no', { length: 100 }).notNull(),
  userId: integer('user_id'),
  referrerCode: varchar('referrer_code', { length: 100 }),
  totalAmount: numeric('total_amount').notNull(),
  currency: varchar('currency', { length: 10 }).default('TWD'),
  marketRegion: varchar('market_region', { length: 10 }).default('TW'),
  sourceChannel: varchar('source_channel', { length: 50 }),
  shippingFee: numeric('shipping_fee'),
  status: varchar('status', { length: 50 }).default('pending'),
  paymentMethod: varchar('payment_method', { length: 50 }),
  paymentStatus: varchar('payment_status', { length: 50 }),
  paymentTime: timestamp('payment_time'),
  shippingName: varchar('shipping_name', { length: 255 }),
  shippingPhone: varchar('shipping_phone', { length: 50 }),
  shippingAddress: text('shipping_address'),
  shippingCity: varchar('shipping_city', { length: 100 }),
  shippingZip: varchar('shipping_zip', { length: 20 }),
  trackingNumber: varchar('tracking_no', { length: 100 }),
  shippedAt: timestamp('shipped_at'),
  completedAt: timestamp('completed_at'),
  cancelledAt: timestamp('cancelled_at'),
  cancelReason: text('cancel_reason'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const orderItems = pgTable('order_items', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id'),
  productId: integer('product_id'),
  productName: varchar('product_name', { length: 255 }),
  productImage: varchar('product_image', { length: 500 }),
  unitPrice: numeric('price').notNull(),
  quantity: integer('quantity').default(1).notNull(),
  commissionRate: numeric('commission_rate'),
  currency: varchar('currency', { length: 10 }).default('TWD'),
  subtotal: numeric('subtotal'),
});

export const commissions = pgTable('commissions', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id'),
  orderItemId: integer('order_item_id'),
  productId: integer('product_id'),
  userId: integer('recipient_id'),
  commissionType: varchar('recipient_level', { length: 50 }),
  amount: numeric('amount').notNull(),
  rate: numeric('rate').notNull(),
  status: varchar('status', { length: 50 }).default('pending'),
  availableAt: timestamp('available_at'),
  withdrawnAt: timestamp('withdrawn_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const supportTickets = pgTable('support_tickets', {
  id: serial('id').primaryKey(),
  userId: integer('user_id'),
  name: varchar('name', { length: 255 }),
  email: varchar('email', { length: 255 }),
  phone: varchar('phone', { length: 50 }),
  type: varchar('type', { length: 50 }).notNull(),
  subject: varchar('subject', { length: 255 }).notNull(),
  message: text('message').notNull(),
  orderId: integer('order_id'),
  status: varchar('status', { length: 50 }).default('open'),
  adminReply: text('admin_reply'),
  repliedAt: timestamp('replied_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const userIdentities = pgTable('user_identities', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  provider: varchar('provider', { length: 50 }).notNull(),
  providerUserId: varchar('provider_user_id', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 255 }),
  avatarUrl: text('avatar_url'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  providerUserUnique: uniqueIndex('user_identities_provider_user_unique').on(
    table.provider,
    table.providerUserId
  ),
}));

export const outboundNotifications = pgTable('outbound_notifications', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  provider: varchar('provider', { length: 50 }).notNull(),
  templateKey: varchar('template_key', { length: 100 }).notNull(),
  payload: jsonb('payload').default({}).notNull(),
  status: varchar('status', { length: 50 }).default('pending').notNull(),
  sentAt: timestamp('sent_at'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const demoInvites = pgTable('demo_invites', {
  id: serial('id').primaryKey(),
  tokenHash: varchar('token_hash', { length: 128 }).notNull(),
  codeHash: varchar('code_hash', { length: 128 }).notNull(),
  referralCode: varchar('referral_code', { length: 100 }),
  referrerMemberId: integer('referrer_member_id').references(() => users.id),
  nickname: varchar('nickname', { length: 255 }),
  identityCompletedAt: timestamp('identity_completed_at'),
  status: varchar('status', { length: 30 }).default('pending').notNull(),
  persistentAccess: boolean('persistent_access').default(false).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  maxUses: integer('max_uses').default(1).notNull(),
  useCount: integer('use_count').default(0).notNull(),
  attempts: integer('attempts').default(0).notNull(),
  lockedUntil: timestamp('locked_until'),
  createdBy: integer('created_by').references(() => users.id).notNull(),
  memberId: integer('member_id').references(() => users.id),
  brandId: integer('brand_id'),
  idempotencyKey: varchar('idempotency_key', { length: 160 }),
  consumedAt: timestamp('consumed_at'),
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  tokenHashUnique: uniqueIndex('demo_invites_token_hash_unique').on(table.tokenHash),
  idempotencyUnique: uniqueIndex('demo_invites_idempotency_unique').on(table.idempotencyKey),
}));

export const authChallenges = pgTable('auth_challenges', {
  id: serial('id').primaryKey(),
  challengeKey: varchar('challenge_key', { length: 120 }).notNull(),
  codeHash: varchar('code_hash', { length: 128 }).notNull(),
  status: varchar('status', { length: 30 }).default('pending').notNull(),
  persistentAccess: boolean('persistent_access').default(false).notNull(),
  memberId: integer('member_id').references(() => users.id).notNull(),
  brandId: integer('brand_id').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  attempts: integer('attempts').default(0).notNull(),
  lockedUntil: timestamp('locked_until'),
  createdBy: integer('created_by').references(() => users.id).notNull(),
  consumedAt: timestamp('consumed_at'),
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  challengeKeyUnique: uniqueIndex('auth_challenges_key_unique').on(table.challengeKey),
}));

export const memberExternalIdentities = pgTable('member_external_identities', {
  id: serial('id').primaryKey(),
  memberId: integer('member_id').references(() => users.id).notNull(),
  provider: varchar('provider', { length: 50 }).notNull(),
  source: varchar('source', { length: 80 }).notNull(),
  appId: varchar('app_id', { length: 160 }).notNull(),
  openId: varchar('open_id', { length: 255 }).notNull(),
  unionId: varchar('union_id', { length: 255 }),
  verifiedPhone: varchar('verified_phone', { length: 50 }),
  phoneVerifiedAt: timestamp('phone_verified_at'),
  displayName: varchar('display_name', { length: 255 }),
  avatarUrl: text('avatar_url'),
  mergePolicy: varchar('merge_policy', { length: 80 }).default('active_session_or_confirmed_unionid').notNull(),
  metadata: jsonb('metadata').default({}).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  providerOpenIdUnique: uniqueIndex('member_external_identities_provider_open_id_unique').on(table.provider, table.appId, table.openId),
  unionIdIndex: index('member_external_identities_union_id_idx').on(table.unionId),
  verifiedPhoneIndex: index('member_external_identities_verified_phone_idx').on(table.verifiedPhone),
}));

export const brands = pgTable('brands', {
  id: serial('id').primaryKey(),
  slug: varchar('slug', { length: 255 }).notNull(),
  brandName: varchar('brand_name', { length: 255 }).notNull(),
  companyName: varchar('company_name', { length: 255 }).notNull(),
  category: varchar('category', { length: 120 }),
  categoryMajorId: varchar('category_major_id', { length: 80 }),
  categoryMinorId: varchar('category_minor_id', { length: 80 }),
  categoryMajorLabel: varchar('category_major_label', { length: 120 }),
  categoryMinorLabel: varchar('category_minor_label', { length: 120 }),
  categoryLabel: varchar('category_label', { length: 255 }),
  introduction: text('introduction').notNull(),
  logoUrl: text('logo_url'),
  commissionDefaults: jsonb('commission_defaults').default({ directRate: 30, upperRate: 5, activeRate: 65 }).notNull(),
  ownerMemberId: integer('owner_member_id').references(() => users.id).notNull(),
  status: varchar('status', { length: 30 }).default('approved').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  brandSlugUnique: uniqueIndex('brands_slug_unique').on(table.slug),
}));

export const brandApplications = pgTable('brand_applications', {
  id: serial('id').primaryKey(),
  brandId: integer('brand_id').references(() => brands.id),
  applicantMemberId: integer('applicant_member_id').references(() => users.id).notNull(),
  status: varchar('status', { length: 30 }).default('pending').notNull(),
  brandName: varchar('brand_name', { length: 255 }).notNull(),
  companyName: varchar('company_name', { length: 255 }).notNull(),
  category: varchar('category', { length: 120 }),
  categoryMajorId: varchar('category_major_id', { length: 80 }),
  categoryMinorId: varchar('category_minor_id', { length: 80 }),
  categoryMajorLabel: varchar('category_major_label', { length: 120 }),
  categoryMinorLabel: varchar('category_minor_label', { length: 120 }),
  categoryLabel: varchar('category_label', { length: 255 }),
  contactName: varchar('contact_name', { length: 255 }),
  contactPhone: varchar('contact_phone', { length: 50 }),
  contactWechat: varchar('contact_wechat', { length: 120 }),
  introduction: text('introduction').notNull(),
  documents: jsonb('documents').default([]).notNull(),
  reviewNote: text('review_note'),
  reviewedAt: timestamp('reviewed_at'),
  reviewedBy: integer('reviewed_by').references(() => users.id),
  idempotencyKey: varchar('idempotency_key', { length: 180 }),
  submittedAt: timestamp('submitted_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  brandApplicationApplicantStatus: index('brand_applications_applicant_status_idx').on(table.applicantMemberId, table.status),
  brandApplicationIdempotency: uniqueIndex('brand_applications_idempotency_unique').on(table.idempotencyKey),
}));

export const brandMembers = pgTable('brand_members', {
  id: serial('id').primaryKey(),
  brandId: integer('brand_id').references(() => brands.id).notNull(),
  memberId: integer('member_id').references(() => users.id).notNull(),
  role: varchar('role', { length: 40 }).default('owner').notNull(),
  status: varchar('status', { length: 30 }).default('active').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  brandMemberUnique: uniqueIndex('brand_members_brand_member_unique').on(table.brandId, table.memberId),
}));

export const brandProducts = pgTable('brand_products', {
  id: serial('id').primaryKey(),
  brandId: integer('brand_id').references(() => brands.id).notNull(),
  ownerMemberId: integer('owner_member_id').references(() => users.id).notNull(),
  slug: varchar('slug', { length: 255 }).notNull(),
  sku: varchar('sku', { length: 120 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  category: varchar('category', { length: 120 }).notNull(),
  description: text('description').notNull(),
  priceCny: numeric('price_cny').notNull(),
  compareAtPriceCny: numeric('compare_at_price_cny'),
  supplyPriceCny: numeric('supply_price_cny'),
  stockQuantity: integer('stock_quantity').default(0).notNull(),
  fulfillmentInfo: text('fulfillment_info').notNull(),
  commissionRate: numeric('commission_rate'),
  directRate: numeric('direct_rate'),
  upperRate: numeric('upper_rate'),
  activeRate: numeric('active_rate'),
  variants: jsonb('variants').default([]).notNull(),
  shippingMethods: jsonb('shipping_methods').default([]).notNull(),
  status: varchar('status', { length: 30 }).default('pending').notNull(),
  reviewStatus: varchar('review_status', { length: 30 }).default('pending').notNull(),
  reviewNote: text('review_note'),
  reviewedAt: timestamp('reviewed_at'),
  reviewedBy: integer('reviewed_by').references(() => users.id),
  isActive: boolean('is_active').default(false).notNull(),
  salesStatus: varchar('sales_status', { length: 30 }).default('draft').notNull(),
  submittedAt: timestamp('submitted_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  brandProductSlugUnique: uniqueIndex('brand_products_brand_slug_unique').on(table.brandId, table.slug),
  brandProductSkuUnique: uniqueIndex('brand_products_brand_sku_unique').on(table.brandId, table.sku),
  brandProductStatusIndex: index('brand_products_brand_status_idx').on(table.brandId, table.status, table.isActive),
}));

export const brandProductImages = pgTable('brand_product_images', {
  id: serial('id').primaryKey(),
  productId: integer('product_id').references(() => brandProducts.id).notNull(),
  brandId: integer('brand_id').references(() => brands.id).notNull(),
  storageObjectId: integer('storage_object_id'),
  url: text('url').notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  altText: varchar('alt_text', { length: 255 }),
  sha256: varchar('sha256', { length: 128 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  brandProductImageOrderUnique: uniqueIndex('brand_product_images_product_order_unique').on(table.productId, table.sortOrder),
}));

export const brandPageVersions = pgTable('brand_page_versions', {
  id: serial('id').primaryKey(),
  brandId: integer('brand_id').references(() => brands.id).notNull(),
  kind: varchar('kind', { length: 20 }).notNull(),
  version: integer('version').default(1).notNull(),
  document: jsonb('document').notNull(),
  createdBy: integer('created_by').references(() => users.id).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  brandPageKindVersionUnique: uniqueIndex('brand_page_versions_kind_version_unique').on(table.brandId, table.kind, table.version),
}));

export const objectStorageObjects = pgTable('object_storage_objects', {
  id: serial('id').primaryKey(),
  provider: varchar('provider', { length: 50 }).notNull(),
  bucket: varchar('bucket', { length: 255 }).notNull(),
  objectKey: text('object_key').notNull(),
  publicUrl: text('public_url').notNull(),
  contentType: varchar('content_type', { length: 120 }).notNull(),
  byteSize: integer('byte_size').notNull(),
  sha256: varchar('sha256', { length: 128 }).notNull(),
  virusScanStatus: varchar('virus_scan_status', { length: 40 }).default('not_configured').notNull(),
  ownerMemberId: integer('owner_member_id').references(() => users.id),
  brandId: integer('brand_id').references(() => brands.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  objectStorageKeyUnique: uniqueIndex('object_storage_objects_provider_bucket_key_unique').on(table.provider, table.bucket, table.objectKey),
  objectStorageDigestIndex: index('object_storage_objects_sha256_idx').on(table.sha256),
}));

export const demoAccessAudit = pgTable('demo_access_audit', {
  id: serial('id').primaryKey(),
  action: varchar('action', { length: 80 }).notNull(),
  actorId: integer('actor_id').references(() => users.id),
  inviteId: integer('invite_id').references(() => demoInvites.id),
  challengeId: integer('challenge_id').references(() => authChallenges.id),
  memberId: integer('member_id').references(() => users.id),
  brandId: integer('brand_id'),
  detail: text('detail').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const brandAuditEvents = pgTable('brand_audit_events', {
  id: serial('id').primaryKey(),
  brandId: integer('brand_id').references(() => brands.id),
  actorId: integer('actor_id').references(() => users.id),
  entityType: varchar('entity_type', { length: 80 }).notNull(),
  entityId: varchar('entity_id', { length: 120 }).notNull(),
  action: varchar('action', { length: 100 }).notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 180 }),
  metadata: jsonb('metadata').default({}).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  brandAuditBrandIndex: index('brand_audit_events_brand_idx').on(table.brandId, table.createdAt),
  brandAuditIdempotency: uniqueIndex('brand_audit_events_idempotency_unique').on(table.idempotencyKey),
}));

export const brandPilotIdempotencyKeys = pgTable('brand_pilot_idempotency_keys', {
  id: serial('id').primaryKey(),
  scope: varchar('scope', { length: 80 }).notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 180 }).notNull(),
  requestHash: varchar('request_hash', { length: 128 }).notNull(),
  response: jsonb('response').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  brandPilotIdempotencyUnique: uniqueIndex('brand_pilot_idempotency_unique').on(table.scope, table.idempotencyKey),
}));

export const authRateLimits = pgTable('auth_rate_limits', {
  id: serial('id').primaryKey(),
  scope: varchar('scope', { length: 80 }).notNull(),
  subjectHash: varchar('subject_hash', { length: 128 }).notNull(),
  attempts: integer('attempts').default(0).notNull(),
  lockedUntil: timestamp('locked_until'),
  windowStartedAt: timestamp('window_started_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  authRateLimitSubjectUnique: uniqueIndex('auth_rate_limits_subject_unique').on(table.scope, table.subjectHash),
}));

export const brandAiAccounts = pgTable('brand_ai_accounts', {
  brandId: integer('brand_id').primaryKey(),
  balanceMicrosCny: bigint('balance_micros_cny', { mode: 'number' }).default(0).notNull(),
  reservedMicrosCny: bigint('reserved_micros_cny', { mode: 'number' }).default(0).notNull(),
  status: varchar('status', { length: 50 }).default('disabled').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const brandAiServicePrices = pgTable('brand_ai_service_prices', {
  id: serial('id').primaryKey(),
  serviceCode: varchar('service_code', { length: 80 }).notNull(),
  provider: varchar('provider', { length: 80 }).notNull(),
  region: varchar('region', { length: 80 }).notNull(),
  model: varchar('model', { length: 120 }).notNull(),
  billingMetric: varchar('billing_metric', { length: 30 }).notNull(),
  officialCurrency: varchar('official_currency', { length: 12 }).notNull(),
  officialUnitCostMicros: bigint('official_unit_cost_micros', { mode: 'number' }).notNull(),
  unitSize: integer('unit_size').default(1).notNull(),
  pricingTier: varchar('pricing_tier', { length: 80 }).default('standard').notNull(),
  effectiveAt: timestamp('effective_at').notNull(),
  disabledAt: timestamp('disabled_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  servicePriceVersion: uniqueIndex('brand_ai_service_price_version_unique').on(
    table.serviceCode,
    table.provider,
    table.region,
    table.model,
    table.effectiveAt
  ),
}));

export const brandAiUsages = pgTable('brand_ai_usages', {
  id: varchar('id', { length: 120 }).primaryKey(),
  brandId: integer('brand_id').notNull(),
  userId: integer('user_id').notNull(),
  serviceCode: varchar('service_code', { length: 80 }).notNull(),
  model: varchar('model', { length: 120 }).notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 180 }).notNull(),
  status: varchar('status', { length: 50 }).default('reserved').notNull(),
  estimatedDebitMicrosCny: bigint('estimated_debit_micros_cny', { mode: 'number' }).notNull(),
  actualDebitMicrosCny: bigint('actual_debit_micros_cny', { mode: 'number' }).default(0).notNull(),
  reservedRefundMicrosCny: bigint('reserved_refund_micros_cny', { mode: 'number' }).default(0).notNull(),
  platformServiceFeeMicrosCny: bigint('platform_service_fee_micros_cny', { mode: 'number' }).default(0).notNull(),
  providerRequestId: varchar('provider_request_id', { length: 180 }),
  promptTokens: integer('prompt_tokens').default(0).notNull(),
  completionTokens: integer('completion_tokens').default(0).notNull(),
  totalTokens: integer('total_tokens').default(0).notNull(),
  imageSuccessCount: integer('image_success_count').default(0).notNull(),
  imageFailedCount: integer('image_failed_count').default(0).notNull(),
  priceSnapshot: jsonb('price_snapshot').default({}).notNull(),
  exchangeRateSnapshot: jsonb('exchange_rate_snapshot').default({}).notNull(),
  providerUsage: jsonb('provider_usage').default({}).notNull(),
  reconciliationStatus: varchar('reconciliation_status', { length: 50 }).default('pending').notNull(),
  officialBillId: varchar('official_bill_id', { length: 120 }),
  requestedAt: timestamp('requested_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
}, (table) => ({
  brandUsageIdempotency: uniqueIndex('brand_ai_usage_brand_idempotency_unique').on(
    table.brandId,
    table.idempotencyKey
  ),
}));

export const brandAiBillingAdjustments = pgTable('brand_ai_billing_adjustments', {
  id: varchar('id', { length: 120 }).primaryKey(),
  usageId: varchar('usage_id', { length: 120 }).notNull(),
  brandId: integer('brand_id').notNull(),
  officialBillId: varchar('official_bill_id', { length: 120 }).notNull(),
  period: varchar('period', { length: 40 }).notNull(),
  amountMicrosCny: bigint('amount_micros_cny', { mode: 'number' }).notNull(),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;
export type Commission = typeof commissions.$inferSelect;
export type NewCommission = typeof commissions.$inferInsert;
export type SupportTicket = typeof supportTickets.$inferSelect;
export type NewSupportTicket = typeof supportTickets.$inferInsert;
export type UserIdentity = typeof userIdentities.$inferSelect;
export type NewUserIdentity = typeof userIdentities.$inferInsert;
export type OutboundNotification = typeof outboundNotifications.$inferSelect;
export type NewOutboundNotification = typeof outboundNotifications.$inferInsert;
export type BrandAiAccount = typeof brandAiAccounts.$inferSelect;
export type NewBrandAiAccount = typeof brandAiAccounts.$inferInsert;
export type BrandAiUsageRow = typeof brandAiUsages.$inferSelect;
export type NewBrandAiUsageRow = typeof brandAiUsages.$inferInsert;
export type Brand = typeof brands.$inferSelect;
export type BrandMember = typeof brandMembers.$inferSelect;
export type BrandProduct = typeof brandProducts.$inferSelect;
export type BrandProductImage = typeof brandProductImages.$inferSelect;
export type BrandPageVersion = typeof brandPageVersions.$inferSelect;
export type ObjectStorageObject = typeof objectStorageObjects.$inferSelect;
