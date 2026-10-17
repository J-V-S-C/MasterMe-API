export interface PaymentGateway {
  createCheckout(input: { handle: string; orderNsu: string; redirectUrl: string; webhookUrl: string; priceInCents: number; description: string }): Promise<{ url: string }>;
  checkPayment(input: { handle: string; orderNsu: string; transactionNsu: string; slug: string }): Promise<{ success: boolean; paid: boolean; amount: number; paidAmount: number | null; installments: number | null; captureMethod: string | null }>;
}
