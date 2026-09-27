package buzz.jixiangruyi1207.srl;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BitmapRegionDecoder;
import android.graphics.Rect;
import android.graphics.Matrix;
import android.media.ExifInterface;
import java.io.File;
import java.io.RandomAccessFile;

/** Shared by card metadata and local image imports; never decode the full bitmap first. */
final class NativeImageDecoder {
    static boolean supportsRegion(File file, BitmapFactory.Options info) throws Exception {
        if (!"image/png".equals(info.outMimeType) || info.outHeight < info.outWidth * 2L) return false;
        // Animated PNG and EXIF-oriented images keep the browser's existing presentation.
        try (RandomAccessFile input = new RandomAccessFile(file, "r")) {
            input.seek(8);
            for (int count = 0; count < 4096 && input.getFilePointer() + 12 <= input.length(); count++) {
                long length = ((long) input.readInt()) & 0xffffffffL;
                int type = input.readInt();
                if (length > input.length() - input.getFilePointer() - 4) return false;
                if (type == 0x6163544c || type == 0x65584966) return false; // acTL / eXIf
                if (type == 0x49444154) return true; // IDAT
                input.seek(input.getFilePointer() + length + 4);
            }
        }
        return false;
    }
    static BitmapFactory.Options bounds(File file) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(file.getAbsolutePath(), bounds);
        return bounds;
    }

    static Bitmap region(File file, Rect region, int edge) throws Exception {
        BitmapRegionDecoder decoder = BitmapRegionDecoder.newInstance(file.getAbsolutePath(), false);
        if (decoder == null) return null;
        try {
            if (region.left < 0 || region.top < 0 || region.right > decoder.getWidth() || region.bottom > decoder.getHeight() || region.isEmpty()) throw new IllegalArgumentException("图片分块范围无效");
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inSampleSize = 1;
            while (Math.max(region.width(), region.height()) / options.inSampleSize > edge) options.inSampleSize *= 2;
            return decoder.decodeRegion(region, options);
        } finally { decoder.recycle(); }
    }

    static Bitmap thumbnail(File file, int edge) throws Exception {
        BitmapFactory.Options bounds = bounds(file);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;
        int sample = 1;
        while (Math.max(bounds.outWidth / sample, bounds.outHeight / sample) > edge * 2) sample *= 2;
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sample;
        Bitmap decoded = BitmapFactory.decodeFile(file.getAbsolutePath(), options);
        if (decoded == null) return null;
        if ("image/jpeg".equals(bounds.outMimeType)) {
            try {
                int orientation = new ExifInterface(file.getAbsolutePath()).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
                float[][] transforms = { null, null,
                    {-1,0,0,0,1,0,0,0,1}, {-1,0,0,0,-1,0,0,0,1},
                    {1,0,0,0,-1,0,0,0,1}, {0,1,0,1,0,0,0,0,1},
                    {0,-1,0,1,0,0,0,0,1}, {0,-1,0,-1,0,0,0,0,1},
                    {0,1,0,-1,0,0,0,0,1} };
                if (orientation >= 2 && orientation <= 8) {
                    Matrix matrix = new Matrix(); matrix.setValues(transforms[orientation]);
                    Bitmap oriented = Bitmap.createBitmap(decoded, 0, 0, decoded.getWidth(), decoded.getHeight(), matrix, true);
                    if (oriented != decoded) decoded.recycle();
                    decoded = oriented;
                }
            } catch (Exception error) { decoded.recycle(); throw error; }
        }
        double scale = Math.min(1.0, (double) edge / Math.max(decoded.getWidth(), decoded.getHeight()));
        if (scale >= 1) return decoded;
        try {
            return Bitmap.createScaledBitmap(decoded,
                Math.max(1, (int) Math.round(decoded.getWidth() * scale)),
                Math.max(1, (int) Math.round(decoded.getHeight() * scale)), true);
        } finally { decoded.recycle(); }
    }
}
