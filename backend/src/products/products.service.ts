import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Product } from './product.entity.js';
import { CreateProductDto, QueryProductsDto } from './products.dto.js';
import { WarehouseService } from '../warehouse/warehouse.service.js';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product) private readonly products: Repository<Product>,
    private readonly warehouse: WarehouseService,
  ) {}

  create(
    { name, description, price, category }: CreateProductDto,
    imageUrl: string | null,
  ) {
    return this.products.save({ name, description, price, category, imageUrl });
  }

  async findAll({ category, page = 1, limit = 10 }: QueryProductsDto) {
    const [items, total] = await this.products.findAndCount({
      where: category ? { category } : {},
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total, page, limit };
  }

  async findOne(id: string) {
    const product = await this.products.findOneBy({ id });
    if (!product) throw new NotFoundException('Product not found');
    try {
      return Object.assign(product, {
        stock: await this.warehouse.getStock(id),
      });
    } catch (error) {
      // The product is still shown when the warehouse is down, only without stock.
      return Object.assign(product, {
        stock: null,
        stockError: (error as Error).message,
      });
    }
  }

  async setStock(id: string, quantity: number) {
    if (!(await this.products.existsBy({ id }))) {
      throw new NotFoundException('Product not found');
    }
    await this.warehouse.setStock(id, quantity);
    return { productId: id, stock: quantity };
  }

  /** For other modules: they ask for prices here instead of reading our table. */
  async getPrices(ids: string[]): Promise<Record<string, string>> {
    const products = await this.products.findBy({ id: In(ids) });
    if (products.length !== ids.length) {
      throw new UnprocessableEntityException('Some products do not exist');
    }
    return Object.fromEntries(products.map((p) => [p.id, p.price]));
  }
}
