import {
  AuthorityAuthorizationHook,
  JWTAuthenticationHook,
  Oauth2AuthenticationHook,
  SessionHeaderAuthenticationHook,
} from '@commercetools/connect-payments-sdk';
import { Type } from '@sinclair/typebox';
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { ConfigResponseSchema, ConfigResponseSchemaDTO } from '../dtos/operations/config.dto';
import { SupportedPaymentComponentsSchema } from '../dtos/operations/payment-componets.dto';
import {
  PaymentIntentRequestSchema,
  PaymentIntentRequestSchemaDTO,
  PaymentIntentResponseSchema,
  PaymentIntentResponseSchemaDTO,
} from '../dtos/operations/payment-intents.dto';
import { StatusResponseSchema, StatusResponseSchemaDTO } from '../dtos/operations/status.dto';
import { AbstractPaymentService } from '../services/abstract-payment.service';
import {
  TransactionDraft,
  TransactionDraftSchemaDTO,
  TransactionResponse,
  TransactionResponseSchemaDTO,
} from '../dtos/operations/transaction.dto';

type OperationRouteOptions = {
  sessionHeaderAuthHook: SessionHeaderAuthenticationHook;
  oauth2AuthHook: Oauth2AuthenticationHook;
  jwtAuthHook: JWTAuthenticationHook;
  authorizationHook: AuthorityAuthorizationHook;
  paymentService: AbstractPaymentService;
};

export const operationsRoute = async (fastify: FastifyInstance, opts: FastifyPluginOptions & OperationRouteOptions) => {
  fastify.get<{ Reply: ConfigResponseSchemaDTO }>(
    '/config',
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
      schema: {
        response: {
          200: ConfigResponseSchema,
        },
      },
    },
    async (_, reply) => {
      const config = await opts.paymentService.config();
      reply.code(200).send(config);
    },
  );

  fastify.get<{ Reply: StatusResponseSchemaDTO }>(
    '/status',
    {
      preHandler: [opts.jwtAuthHook.authenticate()],
      schema: {
        response: {
          200: StatusResponseSchema,
        },
      },
    },
    async (_, reply) => {
      const status = await opts.paymentService.status();
      reply.code(200).send(status);
    },
  );

  fastify.get(
    '/payment-components',
    {
      preHandler: [opts.jwtAuthHook.authenticate()],
      schema: {
        response: {
          200: SupportedPaymentComponentsSchema,
        },
      },
    },
    async (_, reply) => {
      const result = await opts.paymentService.getSupportedPaymentComponents();
      reply.code(200).send(result);
    },
  );

  fastify.post<{ Body: PaymentIntentRequestSchemaDTO; Reply: PaymentIntentResponseSchemaDTO; Params: { id: string } }>(
    '/payment-intents/:id',
    {
      preHandler: [
        opts.oauth2AuthHook.authenticate(),
        opts.authorizationHook.authorize('manage_project', 'manage_checkout_payment_intents'),
      ],
      schema: {
        params: {
          $id: 'paramsSchema',
          type: 'object',
          properties: {
            id: Type.String(),
          },
          required: ['id'],
        },
        body: PaymentIntentRequestSchema,
        response: {
          200: PaymentIntentResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const resp = await opts.paymentService.modifyPayment({
        paymentId: id,
        data: request.body,
      });

      return reply.status(200).send(resp);
    },
  );

  // Create transaction
  fastify.post<{ Body: TransactionDraftSchemaDTO; Reply: TransactionResponseSchemaDTO }>(
    '/transactions',
    {
      preHandler: [
        opts.oauth2AuthHook.authenticate(),
        opts.authorizationHook.authorize('manage_project', 'manage_checkout_transactions'),
      ],
      schema: {
        body: TransactionDraft,
        response: {
          200: TransactionResponse,
        },
      },
    },
    async (request, reply) => {
      const result = await opts.paymentService.handleTransaction(request.body);

      // TODO: SCC-2580: find a nicer solution to the isSuccess flows
      if (result.isSuccess) {
        return reply.status(201).send({
          transactionStatus: {
            errors: [],
            state: 'Pending',
          },
        });
      } else {
        return reply.status(201).send({
          transactionStatus: {
            errors: [
              {
                code: 'PaymentRejected',
                message: `Payment '${result.payment.id}' has been rejected.`,
              },
            ],
            state: 'Failed',
          },
        });
      }
    },
  );
};
