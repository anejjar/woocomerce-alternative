import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { sendOrderConfirmation, sendAdminOrderAlert } from '@/lib/email';
import { z } from 'zod';

const orderSchema = z.object({
  items: z.array(
    z.object({
      productId: z.string(),
      variantId: z.string().optional(),
      quantity: z.number().int().positive(),
    })
  ),
  shippingAddress: z.object({
    street: z.string(),
    city: z.string(),
    state: z.string(),
    zip: z.string(),
  }),
  billingAddress: z
    .object({
      street: z.string(),
      city: z.string(),
      state: z.string(),
      zip: z.string(),
    })
    .optional(),
  phone: z.string(),
  email: z.string().email(),
  notes: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const validated = orderSchema.parse(body);

    const user = await getCurrentUser();
    const isGuest = !user;

    const itemsWithDetails = await Promise.all(
      validated.items.map(async (item) => {
        const product = await prisma.product.findUnique({
          where: { id: item.productId },
          include: { variants: true },
        });

        if (!product) {
          throw new Error(`Product ${item.productId} not found`);
        }

        let price = product.price;
        let name = product.name;
        let image = Array.isArray(product.images) && product.images.length > 0 
          ? product.images[0] 
          : null;

        if (item.variantId) {
          const variant = product.variants.find((v) => v.id === item.variantId);
          if (variant) {
            price = variant.price;
            name = `${product.name} - ${variant.value}`;
          }
        }

        return {
          productId: item.productId,
          variantId: item.variantId || null,
          name,
          price,
          quantity: item.quantity,
          image,
        };
      })
    );

    const total = itemsWithDetails.reduce(
      (sum, item) => sum + Number(item.price) * item.quantity,
      0
    );

    const order = await prisma.order.create({
      data: {
        userId: user?.userId || null,
        isGuest,
        email: validated.email,
        phone: validated.phone,
        shippingAddress: validated.shippingAddress,
        billingAddress: validated.billingAddress || validated.shippingAddress,
        notes: validated.notes,
        total,
        items: {
          create: itemsWithDetails,
        },
      },
      include: { items: true },
    });

    try {
      await sendOrderConfirmation({
        orderId: order.id,
        email: order.email,
        name: order.email,
        phone: order.phone,
        total: Number(order.total),
        items: order.items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          price: Number(item.price),
        })),
        shippingAddress: order.shippingAddress as any,
      });

      await sendAdminOrderAlert({
        orderId: order.id,
        email: order.email,
        name: order.email,
        phone: order.phone,
        total: Number(order.total),
        items: order.items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          price: Number(item.price),
        })),
        shippingAddress: order.shippingAddress as any,
      });
    } catch (emailError) {
      console.error('Email sending failed:', emailError);
    }

    return NextResponse.json({ order }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: error.errors }, { status: 400 });
    }
    console.error('Order creation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
