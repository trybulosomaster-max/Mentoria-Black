MENTORIA BLACK — APP PROTEGIDO

Arquivos: index.html, manifest.webmanifest e sw.js.

1. A chave usada no index.html é a chave pública (publishable/anon) do Supabase. Nunca coloque service_role, senha do banco ou outro segredo no HTML.
2. O login usa Supabase Auth com e-mail e senha.
3. Os dados financeiros são carregados somente depois da autenticação e filtrados pelo user_id.
4. As tabelas esperadas são monthly_plans e transactions. As políticas RLS devem permitir ao usuário autenticado consultar apenas os próprios registros.
5. Em Supabase > Authentication > URL Configuration, coloque a URL HTTPS final em Site URL e Redirect URLs.
6. Depois de publicar uma nova versão, se o navegador mostrar uma versão antiga, feche a aba e abra novamente; o Service Worker desta versão usa controle de cache versionado.
