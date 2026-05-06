-- =============================================================================
-- FLEETLY  —  2026-05-06m  —  İstanbul/Marmara büyük limanları pre-seed
-- =============================================================================
-- Yeni firmalar için liman polygonlarını sıfırdan çizmek külfetli; en sık kullanılan
-- limanları kaba dikdörtgen poligonlarla seed ediyoruz. Yönetici sonradan
-- limanlar sayfasından gerçek sınıra göre düzeltebilir (liman_guncelle RPC).
--
-- firma_id NULL = global liman → tüm firmalar görür (bkz. limanlar_select policy).
--
-- Polygon koordinatları (yaklaşık, 2026-05 itibarıyla):
--   • Kumport, Marport, Mardaş (MIP), Medkon: Ambarlı/Beylikdüzü/Avcılar
--   • Galataport: Karaköy
--   • Haydarpaşa: Kadıköy (yolcu/yük karma)
--   • Yeşilköy Kargo: havalimanı kargo terminali (LCAH yakını)
--   • Asyaport: Tekirdağ Barbaros
--
-- Idempotent: aynı ad+global zaten varsa eklemez (firma çoklu seed'i bozmaz).
-- Bağımlılık: 2026_05_06l (limanlar tablosu, PostGIS).
-- =============================================================================

BEGIN;

-- Yardımcı: GeoJSON Polygon'dan geometry, idempotent insert
DO $$
DECLARE
  v_seed jsonb := '[
    {
      "ad":"Kumport",
      "tip":"liman",
      "geo":"{\"type\":\"Polygon\",\"coordinates\":[[[28.685,40.987],[28.715,40.987],[28.715,40.978],[28.685,40.978],[28.685,40.987]]]}",
      "not":"Pre-seed: Ambarlı, Beylikdüzü. Polygon kabaca dikdörtgen — sahile göre düzeltilebilir."
    },
    {
      "ad":"Marport",
      "tip":"liman",
      "geo":"{\"type\":\"Polygon\",\"coordinates\":[[[28.660,40.973],[28.685,40.973],[28.685,40.962],[28.660,40.962],[28.660,40.973]]]}",
      "not":"Pre-seed: Ambarlı batı kanat. Polygon kabaca dikdörtgen."
    },
    {
      "ad":"Mardaş (MIP)",
      "tip":"liman",
      "geo":"{\"type\":\"Polygon\",\"coordinates\":[[[28.715,40.985],[28.730,40.985],[28.730,40.974],[28.715,40.974],[28.715,40.985]]]}",
      "not":"Pre-seed: Ambarlı doğu kanat. Polygon kabaca dikdörtgen."
    },
    {
      "ad":"Medkon",
      "tip":"liman",
      "geo":"{\"type\":\"Polygon\",\"coordinates\":[[[28.685,40.972],[28.700,40.972],[28.700,40.962],[28.685,40.962],[28.685,40.972]]]}",
      "not":"Pre-seed: Ambarlı orta kanat (Marport ile bitişik). Polygon kabaca dikdörtgen."
    },
    {
      "ad":"Galataport",
      "tip":"liman",
      "geo":"{\"type\":\"Polygon\",\"coordinates\":[[[28.975,41.027],[28.991,41.027],[28.991,41.020],[28.975,41.020],[28.975,41.027]]]}",
      "not":"Pre-seed: Karaköy yolcu+kargo terminali."
    },
    {
      "ad":"Haydarpaşa Limanı",
      "tip":"liman",
      "geo":"{\"type\":\"Polygon\",\"coordinates\":[[[29.013,41.012],[29.029,41.012],[29.029,41.000],[29.013,41.000],[29.013,41.012]]]}",
      "not":"Pre-seed: Kadıköy yük + RoRo."
    },
    {
      "ad":"Yeşilköy Kargo",
      "tip":"terminal",
      "geo":"{\"type\":\"Polygon\",\"coordinates\":[[[28.825,40.985],[28.860,40.985],[28.860,40.973],[28.825,40.973],[28.825,40.985]]]}",
      "not":"Pre-seed: İstanbul Havalimanı eski yer (LCAH) hava kargo. Yeni IST kargo dahil edilebilir."
    },
    {
      "ad":"Asyaport",
      "tip":"liman",
      "geo":"{\"type\":\"Polygon\",\"coordinates\":[[[27.330,40.929],[27.355,40.929],[27.355,40.913],[27.330,40.913],[27.330,40.929]]]}",
      "not":"Pre-seed: Tekirdağ Barbaros, Marmara güney büyük konteyner."
    }
  ]'::jsonb;
  v_item jsonb;
BEGIN
  FOR v_item IN SELECT jsonb_array_elements(v_seed)
  LOOP
    -- Aynı isimde global liman varsa atla (idempotent)
    IF NOT EXISTS (
      SELECT 1 FROM public.limanlar
       WHERE firma_id IS NULL AND ad = (v_item->>'ad')
    ) THEN
      INSERT INTO public.limanlar (firma_id, ad, tip, poligon, notlar)
      VALUES (
        NULL,
        v_item->>'ad',
        v_item->>'tip',
        ST_SetSRID(ST_GeomFromGeoJSON(v_item->>'geo'), 4326),
        v_item->>'not'
      );
    END IF;
  END LOOP;
END $$;

COMMIT;

-- =============================================================================
-- DOĞRULAMA
-- =============================================================================
--   SELECT ad, tip, ST_AsText(ST_Centroid(poligon)) FROM public.limanlar
--    WHERE firma_id IS NULL ORDER BY ad;
--
-- Polygon'lar kabaca dikdörtgen — gerçek liman sınırına göre yöneticiler
-- limanlar sayfasındaki harita arayüzünden düzeltebilir (liman_guncelle RPC).
-- =============================================================================
