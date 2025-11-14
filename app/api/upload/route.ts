import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import sharp from 'sharp';
import { getCurrentUser } from '@/lib/auth';

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const uploadDir = join(process.cwd(), 'public', 'uploads');
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    const timestamp = Date.now();
    const filename = `${timestamp}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const filepath = join(uploadDir, filename);

    if (file.type.startsWith('image/')) {
      await sharp(buffer)
        .resize(1200, 1200, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 85 })
        .toFile(filepath.replace(/\.\w+$/, '.jpg'));

      const thumbPath = join(uploadDir, `thumb-${filename.replace(/\.\w+$/, '.jpg')}`);
      await sharp(buffer)
        .resize(400, 400, {
          fit: 'cover',
        })
        .jpeg({ quality: 80 })
        .toFile(thumbPath);

      return NextResponse.json({
        url: `/uploads/${filename.replace(/\.\w+$/, '.jpg')}`,
        thumbnail: `/uploads/thumb-${filename.replace(/\.\w+$/, '.jpg')}`,
      });
    } else {
      await writeFile(filepath, buffer);
      return NextResponse.json({ url: `/uploads/${filename}` });
    }
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
