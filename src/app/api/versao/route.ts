// Carimbo do build, para o app saber se o que está aberto ainda é o que está
// no ar. Gerado no build e servido como arquivo estático — a Netlify entrega
// HTML e estáticos assim com `must-revalidate`, então a resposta é sempre a do
// deploy atual.
//
// Existe porque o app instalado (janela própria, sem barra de endereço) pode
// ficar dias aberto mostrando a versão de quando foi aberto, e quem usa não
// tem como saber disso.

export const dynamic = "force-static";

export function GET() {
  return Response.json({
    ref: process.env.NEXT_PUBLIC_BUILD_REF ?? "local",
    at: process.env.NEXT_PUBLIC_BUILD_AT ?? null,
  });
}
