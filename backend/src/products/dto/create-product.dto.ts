import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateProductDto {
  @ApiProperty({ example: 'Wireless Headphones' })
  @IsString()
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional({ example: 'Over-ear, noise cancelling' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: '49.99', description: 'Decimal price as a string' })
  @IsNumberString()
  price: string;

  @ApiProperty({ example: 'electronics' })
  @IsString()
  @MaxLength(60)
  category: string;

  @ApiProperty({ type: Number, example: 10, description: 'Initial stock, kept by the inventory service' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  quantity: number;
}
