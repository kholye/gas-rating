// Публичные настройки (публичный ключ Supabase создан для публикации в браузере; защита — секретный код и закрытые таблицы).
// Пусто = демо-режим: сайт работает на выдуманных примерах в этом браузере.
export const CONFIG = {
  SUPABASE_URL: 'https://wpdnyplfkaesanndftyg.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_YGM9u1bJer5346DkZqJ8zQ_2labbAAp',
  API_BASE: 'https://d5d5g0uu5ihpf4qfjeg0.g2n58e0c.apigw.yandexcloud.net', // пусто = напрямую в Supabase; адрес своего прокси, если провайдеры режут Supabase (см. docs/runbook.md)
};
