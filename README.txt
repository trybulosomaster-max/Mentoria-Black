MENTORIA BLACK — GESTÃO FINANCEIRA V11

V11 — camada de estabilidade sobre a V10.

Correções priorizadas:
- Identidade visual MB refinada e marca mais limpa no cabeçalho.
- Título atualizado para V11.
- Parsing brasileiro de valores: aceita 1000, 1000,00, 1.000,00 e R$ 1.000,00.
- Validação amigável antes de salvar: informa campos obrigatórios ausentes.
- Categoria não é exigida para receitas; continua sendo tratada como obrigatória para despesas quando aplicável.
- Recarregamento controlado ao trocar ano/mês para evitar painel preso no período anterior.
- Service Worker V11 com invalidação do cache antigo.
- Mantém a V10 como base funcional para não substituir autenticação, Supabase e regras já existentes.

IMPORTANTE:
Esta V11 é uma camada de correção/estabilidade sobre a V10. O arquivo index.html carrega a V10 pelo commit 016928f3aa341e567043710bfec6925b34e1f885 e aplica as correções V11.

Instalação:
1. Substitua index.html.
2. Substitua sw.js.
3. README.txt é opcional.
4. Publique no GitHub Pages.
5. No iPhone, faça uma recarga completa. Se estiver instalado como PWA, feche e abra novamente.
