import { rm } from 'node:fs/promises';
import {
  BadGatewayException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './entities/product.entity.js';
import { CreateProductDto } from './dto/create-product.dto.js';
import { QueryProductsDto } from './dto/query-products.dto.js';
import { InventoryClient } from '../inventory/inventory.client.js';

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ProductWithStock extends Product {
  /** null when the inventory service could not be reached. */
  availableQuantity: number | null;
  stockAvailable: boolean;
}

function withStock(product: Product, availableQuantity: number | null): ProductWithStock {
  return Object.assign(product, {
    availableQuantity,
    stockAvailable: availableQuantity !== null,
  });
}

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
    private readonly inventoryClient: InventoryClient,
  ) {}

  async create(
    dto: CreateProductDto,
    imageUrl: string | null,
  ): Promise<ProductWithStock> {
    const product = await this.productsRepository.save(
      this.productsRepository.create({
        name: dto.name,
        description: dto.description,
        price: dto.price,
        category: dto.category,
        imageUrl,
      }),
    );

    // The stock lives in another service and database, so there is no shared
    // transaction: if the inventory service refuses, undo the product by hand.
    let quantity: number;
    try {
      quantity = await this.inventoryClient.setStock(product.id, dto.quantity);
    } catch (error) {
      await this.productsRepository.delete({ id: product.id });
      if (imageUrl) await rm(`.${imageUrl}`, { force: true });
      throw error;
    }

    return withStock(product, quantity);
  }

  async findAll(query: QueryProductsDto): Promise<PaginatedResult<Product>> {
    const { page, limit, category } = query;

    const [items, total] = await this.productsRepository.findAndCount({
      where: category ? { category } : {},
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async findOne(id: string): Promise<ProductWithStock> {
    const product = await this.productsRepository.findOne({ where: { id } });

    if (!product) throw new NotFoundException('Product not found');

    // Product details still load when the inventory service is down; only the
    // stock figure is missing.
    try {
      const quantity = await this.inventoryClient.getStock(id);
      return withStock(product, quantity);
    } catch (error) {
      if (error instanceof NotFoundException) {
        return withStock(product, 0);
      }
      if (
        error instanceof ServiceUnavailableException ||
        error instanceof BadGatewayException
      ) {
        return withStock(product, null);
      }
      throw error;
    }
  }
}
