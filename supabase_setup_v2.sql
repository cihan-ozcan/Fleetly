-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.activity_log (
  id text NOT NULL,
  type text NOT NULL,
  plaka text,
  detail text,
  ts timestamp with time zone NOT NULL DEFAULT now(),
  user_id uuid,
  firma_id uuid,
  CONSTRAINT activity_log_pkey PRIMARY KEY (id),
  CONSTRAINT activity_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT activity_log_firma_id_fkey FOREIGN KEY (firma_id) REFERENCES public.firmalar(id)
);
CREATE TABLE public.araclar (
  id text NOT NULL,
  plaka text NOT NULL,
  tip text,
  esleme text,
  sofor text,
  telefon text,
  durum text DEFAULT 'Aktif'::text,
  muayene text,
  sigorta text,
  takograf text,
  notlar text,
  created_at timestamp with time zone DEFAULT now(),
  user_id uuid NOT NULL,
  firma_id uuid,
  CONSTRAINT araclar_pkey PRIMARY KEY (id),
  CONSTRAINT araclar_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT araclar_firma_id_fkey FOREIGN KEY (firma_id) REFERENCES public.firmalar(id)
);
CREATE TABLE public.bakim_kayitlari (
  id text NOT NULL,
  user_id uuid NOT NULL,
  arac_id text NOT NULL,
  tarih date NOT NULL,
  tur text NOT NULL,
  aciklama text,
  km numeric,
  maliyet numeric DEFAULT 0,
  sonraki_tarih date,
  sonraki_km numeric,
  servis text,
  created_at timestamp with time zone DEFAULT now(),
  firma_id uuid,
  CONSTRAINT bakim_kayitlari_pkey PRIMARY KEY (id),
  CONSTRAINT bakim_kayitlari_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT bakim_kayitlari_firma_id_fkey FOREIGN KEY (firma_id) REFERENCES public.firmalar(id)
);
CREATE TABLE public.firma_kullanicilar (
  user_id uuid NOT NULL,
  firma_id uuid NOT NULL,
  rol text NOT NULL DEFAULT 'uye'::text,
  CONSTRAINT firma_kullanicilar_pkey PRIMARY KEY (user_id, firma_id),
  CONSTRAINT firma_kullanicilar_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT firma_kullanicilar_firma_id_fkey FOREIGN KEY (firma_id) REFERENCES public.firmalar(id)
);
CREATE TABLE public.firmalar (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  ad text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT firmalar_pkey PRIMARY KEY (id)
);
CREATE TABLE public.masraflar (
  id text NOT NULL,
  user_id uuid NOT NULL,
  firma_id uuid,
  tarih date NOT NULL,
  arac_id text,
  plaka text,
  kategori text NOT NULL,
  tutar numeric NOT NULL DEFAULT 0,
  makbuz text,
  aciklama text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT masraflar_pkey PRIMARY KEY (id),
  CONSTRAINT masraflar_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT masraflar_firma_id_fkey FOREIGN KEY (firma_id) REFERENCES public.firmalar(id)
);
CREATE TABLE public.seferler (
  id text NOT NULL,
  user_id uuid NOT NULL,
  firma_id uuid,
  tarih date NOT NULL,
  arac_id text,
  plaka text,
  sofor text,
  kalkis text NOT NULL,
  varis text NOT NULL,
  km numeric,
  yuk text,
  ucret numeric DEFAULT 0,
  notlar text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT seferler_pkey PRIMARY KEY (id),
  CONSTRAINT seferler_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT seferler_firma_id_fkey FOREIGN KEY (firma_id) REFERENCES public.firmalar(id)
);
CREATE TABLE public.surucu_belgeler (
  id text NOT NULL,
  user_id uuid NOT NULL,
  firma_id uuid,
  arac_id text,
  ad text NOT NULL,
  tel text,
  ehliyet date,
  src date,
  psiko date,
  created_at timestamp with time zone DEFAULT now(),
  takograf date,
  CONSTRAINT surucu_belgeler_pkey PRIMARY KEY (id),
  CONSTRAINT surucu_belgeler_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT surucu_belgeler_firma_id_fkey FOREIGN KEY (firma_id) REFERENCES public.firmalar(id),
  CONSTRAINT surucu_belgeler_arac_id_fkey FOREIGN KEY (arac_id) REFERENCES public.araclar(id)
);
CREATE TABLE public.yakit_girisleri (
  id text NOT NULL,
  arac_id text NOT NULL,
  tarih date NOT NULL,
  km numeric NOT NULL,
  litre numeric NOT NULL,
  fiyat numeric DEFAULT 0,
  aciklama text,
  created_at timestamp with time zone DEFAULT now(),
  user_id uuid NOT NULL,
  firma_id uuid,
  CONSTRAINT yakit_girisleri_pkey PRIMARY KEY (id),
  CONSTRAINT yakit_girisleri_arac_id_fkey FOREIGN KEY (arac_id) REFERENCES public.araclar(id),
  CONSTRAINT yakit_girisleri_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT yakit_girisleri_firma_id_fkey FOREIGN KEY (firma_id) REFERENCES public.firmalar(id)
);
