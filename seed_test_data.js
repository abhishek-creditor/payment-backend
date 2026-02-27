require('dotenv').config({ path: '.env.development' });
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
    const args = process.argv.slice(2);
    const bookId = args[0] || 'test_book_id';
    const priceCents = parseInt(args[1] || '999', 10);
    const title = args.slice(2).join(' ') || `Ebook: ${bookId}`;

    console.log(`--- Seeding Database for Book ID: ${bookId} at ${priceCents} cents, Title: "${title}" ---`);

    // 1. Create or Find Product
    let product = await prisma.product.findUnique({
        where: { code: 'ebook_purchase' }
    });

    if (!product) {
        product = await prisma.product.create({
            data: {
                name: 'Ebook System',
                code: 'ebook_purchase',
                isActive: true
            }
        });
        console.log('✅ Created Product:', product.code);
    } else {
        console.log('✅ Found existing Product:', product.code);
    }

    // 2. Create API Key
    const rawKey = 'pk_test_ebook_1234567890';
    const keyHash = await bcrypt.hash(rawKey, 10);

    const existingKey = await prisma.apiKey.findFirst({
        where: { productId: product.id, keyPrefix: 'pk_test_ebook_' }
    });

    if (!existingKey) {
        await prisma.apiKey.create({
            data: {
                productId: product.id,
                keyName: 'Test Ebook Key',
                keyHash: keyHash,
                keyPrefix: 'pk_test_ebook_',
                environment: 'development',
                permissions: ['charge', 'read', 'refund'],
                rateLimitPerMin: 100,
                isActive: true
            }
        });
        console.log('✅ Created API Key.');
        console.log(`\n\x1b[36m👉 UPDATE ebook_Athena/.env with:\x1b[0m`);
        console.log(`PAYMENT_SERVICE_API_KEY="${rawKey}"\n`);
    } else {
        console.log('✅ API Key already exists. Use: pk_test_ebook_1234567890');
    }

    // 3. Create a test ProductPlan
    const existingPlan = await prisma.productPlan.findFirst({
        where: { productId: product.id, code: bookId }
    });

    if (!existingPlan) {
        await prisma.productPlan.create({
            data: {
                productId: product.id,
                code: bookId,
                name: title,
                price: priceCents,
                currency: 'USD',
                billingType: 'ONE_TIME',
                isActive: true
            }
        });
        console.log(`✅ Created ProductPlan (Book ID: ${bookId}, Title: "${title}") with price $${priceCents / 100}`);
    } else {
        // Optionally update price and title if it exists
        await prisma.productPlan.update({
            where: { id: existingPlan.id },
            data: {
                price: priceCents,
                name: title
            }
        });
        console.log(`✅ Updated ProductPlan (Book ID: ${bookId}) to Title: "${title}", Price: $${priceCents / 100}`);
    }

    console.log('\nSeed completed successfully!');
}

main()
    .catch(e => {
        console.error('Seed failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
