# **Recommended Technology and Growth Plan**

## **Project overview**

The goal is to create a web platform where customers throughout the Dominican Republic can browse, reserve, and eventually purchase motorcycles from the business.

The platform will support:

- Motorcycle listings with photos, prices, specifications, and availability
- Search by brand, model, motorcycle type, price, condition, and location
- Customer inquiries and reservations
- Bank-transfer payment verification during the first phase
- Inventory and sales management
- Internal CRM for customers, leads, sales representatives, and follow-ups
- Business dashboards for sales, inventory, motorcycle demand, and business performance
- Credit and debit card payments in a later phase

---

## **Recommended launch strategy**

The recommended approach is to launch using:

**Vercel + Supabase + Cloudflare + PostHog + Sentry + Google Analytics**

This combination provides a professional, secure, and scalable platform without the higher development and maintenance complexity of building everything directly in AWS from the beginning.

The main advantage is speed. The business can launch sooner, test customer demand, begin collecting leads and sales, and improve the platform based on real customer behavior.

### **Services used during launch**

|**Service**|**Purpose**|
|---|---|
|**Vercel**|Hosts the website, admin dashboard, and application backend functions|
|**Supabase**|Provides the PostgreSQL database, authentication, file storage, backups, and backend services|
|**Cloudflare**|Provides DNS, CDN, SSL, DDoS protection, caching, bot protection, and rate limiting|
|**PostHog**|Tracks motorcycle views, searches, leads, reservations, customer activity, and conversion funnels|
|**Sentry**|Detects application errors, failed requests, performance problems, and crashes|
|**Google Analytics**|Tracks website traffic, marketing campaigns, visitor sources, and general audience behavior|

---

## **Domain name**

The platform should use a professional `.com` domain, such as:

**businessname.com**

The domain can be purchased and managed directly through Vercel. This is the simplest option because the domain can be connected automatically to the website hosted on Vercel.

The domain can later be connected to AWS by changing its DNS configuration. The business would not need to purchase a new domain when migrating.

### **Estimated domain cost**

| **Item**                           | **Estimated cost**                      |
| ---------------------------------- | --------------------------------------- |
| Standard available `.com` domain   | **Approximately $15–$20 per year**      |
| Monthly equivalent                 | **Approximately $1.25–$1.70 per month** |
| Premium or previously owned domain | Can cost substantially more             |

The exact price will depend on the selected name and whether it is considered a standard or premium domain.

The domain price is separate from the Vercel Pro hosting subscription.

The domain also does not automatically include business email hosting. Email addresses such as `ventas@businessname.com` would require a service such as Google Workspace, Microsoft 365, Zoho Mail, or another email provider.

---

## **Estimated launch costs**

|**Service**|**Estimated monthly cost**|
|---|---|
|Vercel Pro|$20|
|Supabase Pro|Starting at $25|
|Cloudflare|$0–$25|
|PostHog|$0 initially|
|Sentry|$0 initially; paid plans may be added later|
|Google Analytics|$0|
|Email delivery service|$0–$10|
|`.com` domain|Approximately $15–$20 per year|
|Additional storage and usage|$0–$30|

Vercel Pro currently has a $20 monthly platform fee and includes one deploying team seat and a monthly usage credit. ([Vercel](https://vercel.com/pricing?utm_source=chatgpt.com))

Supabase Pro starts at $25 per month and currently includes 100,000 monthly active users, 8 GB of database storage, 100 GB of file storage, and usage allowances for data transfer. Usage beyond the included limits is billed separately. ([Supabase](https://supabase.com/pricing?utm_source=chatgpt.com))

PostHog currently includes the first one million product analytics events each month at no charge. ([PostHog](https://posthog.com/product-analytics-explorer/pricing?utm_source=chatgpt.com))

### **Expected total**

**Initial professional MVP:** approximately **$50–$100 per month**

**Active production platform:** approximately **$100–$200 per month**

Costs can increase with image traffic, database usage, analytics volume, additional developer accounts, email volume, storage, premium security features, and application usage.

These estimates cover infrastructure and software services. They do not include:

- Development labor
- Marketing and advertising
- Payment-processing fees
- Legal services
- Accounting
- Customer support personnel
- Business email subscriptions
- Content creation or professional photography

---

## **Payment implementation**

### **Phase 1: bank transfers**

The initial platform should allow customers to reserve a motorcycle and receive bank-transfer instructions.

The process would be:

1. The customer selects a motorcycle.
2. The customer submits a reservation or purchase request.
3. The platform creates a pending order.
4. The customer receives bank-transfer instructions.
5. The customer uploads the transfer receipt.
6. An authorized employee verifies the payment.
7. The motorcycle is marked as reserved or sold.
8. The transaction is recorded in the CRM and sales reports.

The platform should not automatically approve bank transfers. An employee or manager should verify the bank reference, amount, customer, and motorcycle before completing the transaction.

### **Phase 2: card payments**

After the platform proves that customers are actively using it, credit and debit card payments can be added through a payment processor operating in the Dominican Republic.

A practical first card-payment feature would be an online reservation deposit rather than requiring customers to pay the full motorcycle price online.

Card-processing fees are not included in the infrastructure estimates because they will depend on the selected payment processor, transaction volume, negotiated rate, and payment method.

---

## **CRM and business management**

The platform’s database will maintain:

- Customers and contact information
- Customer inquiries
- Motorcycle inventory
- Motorcycle models, brands, types, prices, and availability
- Sales representatives
- Customer follow-up notes
- Reservation and payment status
- Transfer receipt records
- Sales history
- Lead sources
- Branch or dealership locations
- Audit logs showing important employee actions

The business dashboard should measure:

- Total motorcycles available, reserved, and sold
- Most viewed motorcycle brands and models
- Most frequently searched motorcycle types
- Monthly sales and revenue
- Inventory age
- Average time required to sell each model
- Leads received by province or city
- Lead-to-sale conversion rate
- Sales representative performance
- Marketing source performance
- Lost sales and cancellation reasons

---

# **When to begin moving to AWS**

The platform should not migrate to AWS simply because it reaches one specific number of users. The decision should consider:

- Infrastructure costs
- Website traffic
- Customer activity
- Database size
- Image traffic
- Security requirements
- Reliability requirements
- Number of business branches
- Business revenue
- Availability of technical personnel

The following monthly active-user ranges provide a practical planning guideline.

A monthly active user is a unique user who interacts with the platform during a particular month. It is different from total page views, anonymous website visitors, or registered accounts.

The cost ranges below are estimates. Two platforms with the same number of active users may have very different costs depending on image downloads, analytics events, database queries, file uploads, server processing, and customer behavior.

---

## **0–25,000 monthly active users**

### **Recommended action**

Remain on the original launch stack:

**Vercel + Supabase + Cloudflare + PostHog + Sentry + Google Analytics**

At this level, the recommended services should be more than sufficient for the business.

### **Estimated monthly infrastructure cost**

**Approximately $50–$150 per month**

A typical cost at the beginning may be closer to $50–$100. The cost may approach $150 if the business adds paid monitoring, greater image storage, more email delivery, or premium Cloudflare features.

### **Primary objectives**

- Validate customer demand
- Improve the browsing and buying experience
- Build inventory and CRM workflows
- Track conversion rates
- Identify the most popular motorcycle models
- Generate consistent leads and sales
- Improve the bank-transfer verification process
- Establish reliable business operations

No AWS migration is recommended at this stage unless there is a specific regulatory, security, contractual, or technical requirement.

---

## **25,000–50,000 monthly active users**

### **Recommended action**

Begin an AWS readiness review, but do not automatically migrate.

At this stage, the original platform should still be capable of supporting the business. The company should begin documenting and preparing for future infrastructure changes.

### **Estimated monthly infrastructure cost**

**Approximately $100–$250 per month**

The exact amount will depend more on usage than user count. For example, a platform with many high-resolution motorcycle images or extensive session recordings may cost more than one with mostly text and compressed images.

### **Development and business actions**

- Review infrastructure costs every month
- Identify which services are producing the largest expenses
- Review database and storage growth
- Test database backup and restoration procedures
- Test data export procedures
- Separate business logic from Supabase-specific functionality
- Avoid unnecessary dependence on proprietary platform features
- Confirm that images can later be moved to Amazon S3
- Document the current architecture
- Document environment variables and deployment procedures
- Evaluate AWS security and disaster-recovery requirements
- Create separate development, staging, and production environments when needed

This stage is primarily about preparation. Migration does not need to begin unless the business has a clear operational or financial reason.

---

## **50,000–100,000 monthly active users**

### **Recommended action**

Seriously evaluate a gradual AWS transition, particularly if the platform is producing consistent revenue and becoming essential to daily business operations.

Supabase Pro currently includes up to 100,000 monthly active users before additional per-user charges apply. Therefore, reaching 50,000 users does not automatically create a technical requirement to leave Supabase. ([Supabase](https://supabase.com/pricing?utm_source=chatgpt.com))

### **Estimated monthly infrastructure cost**

**Approximately $150–$400 per month**

The platform may remain near the lower end if usage stays within the included Vercel, Supabase, Cloudflare, PostHog, and Sentry allowances.

The platform may approach or exceed the upper end when it has:

- High image traffic
- Large numbers of analytics events
- Extensive session recordings
- Large file storage
- Multiple team members
- Separate staging and production environments
- Frequent database backups
- High email or notification volume
- Greater server-function usage
- Premium security requirements

### **When AWS becomes more attractive**

AWS migration becomes more attractive when the business requires:

- Greater control over infrastructure
- Advanced employee permissions
- Multiple business locations or branches
- High-volume image storage
- Custom reporting and data pipelines
- Stronger backup and disaster-recovery systems
- Integration with accounting, financing, or enterprise systems
- Dedicated development, staging, and production environments
- Private networking
- Greater infrastructure monitoring
- Predictable long-term infrastructure planning

### **Recommended migration approach**

Begin moving individual components only when doing so provides a clear benefit.

For example:

1. Move motorcycle photos to Amazon S3.
2. Add Amazon CloudFront for image delivery.
3. Move background jobs to AWS.
4. Move the PostgreSQL database only after testing and planning.
5. Move authentication last because it is usually one of the more sensitive migrations.

---

## **Above 100,000 monthly active users**

### **Recommended action**

Complete a formal architecture, security, and cost review.

At this stage, the business should compare three possibilities:

1. Continue expanding the original managed-service stack.
2. Use a hybrid architecture combining the original services with AWS.
3. Gradually complete a larger migration into AWS.

### **Estimated monthly infrastructure cost before or during migration**

**Approximately $300–$800 or more per month**

This range may include:

- Vercel overage charges
- Supabase usage above included limits
- Greater database storage
- Greater file storage and bandwidth
- PostHog usage above its free tier
- Paid Sentry monitoring
- Premium Cloudflare security
- Multiple production environments
- AWS services being introduced during a hybrid migration

A high-activity platform with large image traffic, multiple branches, extensive analytics, and strong availability requirements could exceed this range.

### **AWS migration should be strongly considered when:**

- Monthly infrastructure costs consistently exceed approximately $300–$500
- The database regularly approaches plan limits
- Application usage is growing rapidly
- The business operates across several branches
- The platform has become a primary sales channel
- Downtime would directly cause substantial lost revenue
- The platform requires enterprise-level audit logs
- The company requires private networking or more advanced security
- Analytics processing begins affecting the production database
- The company has a developer or technical team capable of maintaining AWS
- AWS provides a measurable financial, reliability, or operational advantage

The active-user thresholds are planning guidelines, not absolute limits.

A profitable platform with 20,000 highly active customers and heavy image traffic may require AWS earlier. A platform with 100,000 occasional visitors and limited activity may continue operating comfortably on the original stack.

---

# **Recommended AWS migration path**

The transition should be gradual rather than moving the entire application at once.

## **Step 1: move files and images**

Move motorcycle photos, transfer receipts, and business documents from Supabase Storage to **Amazon S3**.

Use **Amazon CloudFront** as the CDN to deliver those files quickly and securely.

This is normally one of the safest components to migrate first because it does not require immediately changing the database or authentication system.

---

## **Step 2: move the database**

Move the PostgreSQL database from Supabase to **Amazon RDS for PostgreSQL**.

Because Supabase and Amazon RDS both support PostgreSQL, this migration should be manageable if the application:

- Uses standard PostgreSQL
- Keeps business logic inside its own backend
- Avoids unnecessary platform-specific database features
- Maintains reliable database migrations
- Has tested backup and restoration procedures

Amazon RDS can provide:

- Automated backups
- Database snapshots
- SSL connections
- Multi-AZ deployments
- Read replicas
- Private networking
- Database monitoring

---

## **Step 3: move backend operations**

Move backend functions and background processes to:

- **Amazon API Gateway** for API routing
- **AWS Lambda** for serverless backend functions
- **Amazon SQS** for background jobs
- **Amazon EventBridge** for scheduled reports and automated processes
- **Amazon SES** for transactional email

Examples of operations that could move to AWS include:

- Reservation processing
- Transfer receipt processing
- Email notifications
- Inventory alerts
- Scheduled sales reports
- CRM follow-up reminders
- Image processing
- Data exports

---

## **Step 4: move authentication if necessary**

Supabase Auth may eventually be replaced with **Amazon Cognito**.

Authentication should be moved carefully because user passwords generally cannot simply be exported in plain text.

The migration may require:

- A staged authentication migration
- Temporary compatibility between both systems
- Password reset emails
- Account verification
- Testing customer and employee permissions
- Reconfiguring role-based access

Authentication should usually be one of the final services migrated.

---

## **Step 5: move frontend hosting**

The frontend can move from Vercel to:

- **AWS Amplify Hosting**, or
- **Amazon S3 with Amazon CloudFront**

AWS Amplify provides deployment, Git integration, SSL certificates, frontend hosting, and support for modern web application frameworks.

The `.com` domain would remain the same. Its DNS records would simply be updated to point to the AWS-hosted application.

---

## **Step 6: add AWS monitoring and analytics**

Add:

- **Amazon CloudWatch** for infrastructure logs and alerts
- **AWS WAF** for application security
- **AWS CloudTrail** for administrative audit history
- **Amazon Athena** for querying analytics data
- **Amazon QuickSight** for advanced business reporting

PostHog, Sentry, and Google Analytics do not have to be removed immediately.

They can continue operating alongside AWS because they provide specialized product, error, and marketing analytics that would require additional time and development to reproduce fully through AWS.

---

# **Estimated AWS costs after migration**

A small AWS production environment could include:

|**AWS service**|**Estimated monthly cost**|
|---|---|
|Amplify or frontend hosting|$5–$30|
|Route 53 DNS|Approximately $0.50 plus DNS queries|
|CloudFront|$0–$30 initially|
|API Gateway|$0–$20|
|Lambda|$0–$20|
|RDS PostgreSQL|$30–$150|
|S3 storage|$1–$30|
|CloudWatch|$5–$50|
|Cognito|Often $0 initially|
|SES email|$0–$10|
|Security and backups|$10–$75|

### **Expected AWS total**

**Small AWS production system:** approximately **$75–$250 per month**

**Growing production business:** approximately **$200–$600 per month**

**Higher-availability system:** approximately **$500 or more per month**

AWS costs vary by region, traffic, database size, data transfer, backup retention, logging volume, availability requirements, and security configuration.

These estimates do not include the labor required to design, migrate, operate, monitor, and maintain the AWS environment.

---

# **Final recommendation**

Launch with:

**Vercel + Supabase + Cloudflare + PostHog + Sentry + Google Analytics**

Purchase and connect a professional `.com` domain through Vercel for approximately **$15–$20 per year**, assuming the selected name is available and is not a premium domain.

This approach provides the fastest and most cost-effective way to launch a professional motorcycle marketplace and CRM.

The recommended growth plan is:

|**Monthly active users**|**Estimated monthly cost**|**Recommended action**|
|---|---|---|
|**0–25,000**|**$50–$150**|Remain on the original stack and validate the business|
|**25,000–50,000**|**$100–$250**|Begin AWS readiness planning|
|**50,000–100,000**|**$150–$400**|Evaluate and potentially begin a gradual AWS transition|
|**Above 100,000**|**$300–$800+**|Conduct a formal architecture and cost review and strongly consider AWS or a hybrid architecture|

Migration should occur only when the business has:

- Proven customer demand
- Consistent sales
- Growing infrastructure requirements
- A measurable need for greater control or reliability
- Enough technical capacity to operate AWS properly
- A clear financial or operational reason to migrate

The recommended strategy is:

1. Launch quickly using managed services.
2. Validate demand and improve the sales process.
3. Build consistent business revenue.
4. Monitor infrastructure costs and performance.
5. Prepare the architecture for portability.
6. Begin AWS planning between 25,000 and 50,000 monthly active users.
7. Consider gradual migration between 50,000 and 100,000 monthly active users.
8. Migrate individual components as the business grows.
9. Complete a larger AWS transition only when it creates a clear operational or financial benefit.