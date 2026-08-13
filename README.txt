MENTORIA BLACK — GESTÃO FINANCEIRA V12

V12 é uma base única e independente. Não carrega V10/V11 por document.write nem usa wrapper externo.

CORREÇÕES PRINCIPAIS
- Persistência de lançamentos: confirmação explícita do retorno do banco após insert/update.
- Lançamentos futuros não são automaticamente convertidos para "pendente"; o status escolhido pelo usuário é preservado.
- Dashboard mostra também o total de lançamentos pendentes.
- Receitas podem ser salvas sem categoria. Despesas e investimentos exigem categoria.
- Mensagens de validação explicam exatamente o campo obrigatório ausente.
- Valor total aceita formatos: 1000 / 1000,50 / 1.000 / 1.000,50 / R$ 1.000,50 / 1,000.50.
- Ao sair do campo, o valor é normalizado para padrão brasileiro (ex.: 1.000,50).
- No salvamento, o valor é interpretado novamente; portanto pontos e vírgulas não dependem do navegador.
- Evita duplo clique/duplo envio durante o salvamento.
- Carregamento de dados em páginas de até 1.000 registros, reduzindo o risco de perder lançamentos antigos quando o volume crescer.
- Falha de tabela opcional não derruba toda a aplicação; a tabela de transações continua sendo tratada como crítica.
- Logo MB refinado em vetor, mantendo MENTORIA BLACK / GESTÃO FINANCEIRA.
- Service Worker atualizado para V12 e limpeza de caches anteriores.
- Anos de 2000 a 2100.
- Parcelamento e despesa fixa continuam separados.
- Gráficos continuam usando as cores cadastradas por categoria.

TESTES REALIZADOS
- JavaScript principal passou por verificação de sintaxe com Node.js.
- Parser monetário testado com formatos brasileiros e mistos.
- Verificada a lógica de parcelamento e preservação de status.

INSTALAÇÃO
1. No GitHub Pages, substitua index.html.
2. Substitua sw.js.
3. README.txt é apenas documentação.
4. Aguarde o GitHub Pages publicar.
5. Feche completamente o Safari/PWA e abra novamente para o Service Worker V12 assumir.

OBSERVAÇÃO SOBRE DADOS
A V12 não altera nem migra o banco Supabase. Ela usa as mesmas tabelas da base existente para preservar os dados já cadastrados.
