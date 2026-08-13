MENTORIA BLACK — APP PROTEGIDO

1. No index.html, substitua COLE_AQUI_SUA_CHAVE_ANON_PUBLICA pela chave pública (anon) do Supabase.
2. NUNCA coloque service_role, database password ou outro segredo no HTML.
3. Hospede estes arquivos em uma URL HTTPS.
4. No Supabase > Authentication > URL Configuration, coloque a URL HTTPS final em Site URL e Redirect URLs.
5. O banco usa RLS e o app consulta somente os registros do usuário autenticado.
