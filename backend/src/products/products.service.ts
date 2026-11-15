import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CacheService } from '../common/cache.service.js';
import { Product } from './product.entity.js';
import {
  CreateProductDto,
  QueryProductsDto,
  UpdateProductDto,
} from './products.dto.js';
import { WarehouseService } from '../warehouse/warehouse.service.js';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(Product, 'replica')
    private readonly replica: Repository<Product>,
    private readonly warehouse: WarehouseService,
    private readonly cache: CacheService,
  ) {}

  async create(
    { name, description, price, category }: CreateProductDto,
    imageUrl: string | null,
  ) {
    const product = await this.products.save({
      name,
      description,
      price,
      category,
      imageUrl,
    });
    await this.changed();
    return product;
  }

  async update(id: string, dto: UpdateProductDto) {
    const product = await this.products.findOneBy({ id });
    if (!product) throw new NotFoundException('Product not found');
    await this.products.save(Object.assign(product, dto));
    await this.changed();
    return product;
  }

  findAll({ category, page = 1, limit = 10 }: QueryProductsDto) {
    const key = `list:${category ?? ''}:${page}:${limit}`;
    return this.cache.wrap('products', key, async () => {
      const [items, total] = await (
        await this.reader()
      ).findAndCount({
        where: category ? { category } : {},
        order: { createdAt: 'DESC' },
        skip: (page - 1) * limit,
        take: limit,
      });
      return { items, total, page, limit };
    });
  }

  async findOne(id: string) {
    const product = await this.cache.wrap('products', id, async () => {
      const product = await (await this.reader()).findOneBy({ id });
      if (!product) throw new NotFoundException('Product not found');
      return product;
    });
    // Stock is never cached: it must be exact, so it is always asked from the warehouse.
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

  /** After any change: drop the cached products and read the primary for a few seconds. */
  private async changed() {
    await this.cache.markWrite('products');
    await this.cache.invalidate('products');
  }

  /** The replica, unless a product changed a moment ago and the replica may not have it yet. */
  private async reader() {
    return (await this.cache.wroteRecently('products'))
      ? this.products
      : this.replica;
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
