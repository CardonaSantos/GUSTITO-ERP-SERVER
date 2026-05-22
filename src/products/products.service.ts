import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  MethodNotAllowedException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateNewProductDto } from './dto/create-productNew.dto';
import { MinimunStockAlertService } from 'src/minimun-stock-alert/minimun-stock-alert.service';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';
import {
  EstadoPrecio,
  Prisma,
  Rol,
  RolPrecio,
  TipoPrecio,
  TipoProductoInventario,
} from '@prisma/client';
import { PresentacionProductoService } from 'src/presentacion-producto/presentacion-producto.service';
import { ProductoApi } from './dto/interfacesPromise';
import { QueryParamsInventariado } from './query/query';
import {
  presentacionSelect,
  PresentacionWithSelect,
  productoSelect,
  ProductoWithSelect,
} from './SelectsAndWheres/Selects';
import {
  PrecioProductoNormalized,
  ProductoInventarioResponse,
  StockPorSucursal,
  StocksBySucursal,
  StocksProducto,
} from './ResponseInterface';
import { dayjs } from 'src/utils/dayjs';
import { newQueryDTO } from './query/newQuery';
import { verifyProps } from 'src/utils/verifyPropsFromDTO';
import { buildSearchForPresentacion, buildSearchForProducto } from './HELPERS';
import { itemsBase } from './seed/utils';
import { DeleteProductDto } from './dto/delete-dto';
import brcrypt from 'bcryptjs';

const INS = 'insensitive' as const;

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly presentacionPrducto: PresentacionProductoService,
  ) {}
  private dec = (v: any): string => (v == null ? '0' : String(v));

  async create(dto: CreateNewProductDto, imagenes: Express.Multer.File[]) {
    try {
      const {
        codigoProducto,
        creadoPorId,
        nombre,
        precioVenta,
        categorias,
        codigoProveedor,
        descripcion,
        precioCostoActual,
        stockMinimo,
        tipoInventario,
        visibleEnPos,
      } = dto;

      return await this.prisma.$transaction(async (tx) => {
        const dup = await tx.producto.findUnique({
          where: { codigoProducto },
        });

        if (dup) {
          throw new BadRequestException(
            `Ya existe un producto con código "${codigoProducto}"`,
          );
        }

        if (codigoProveedor) {
          const dupProveedor = await tx.producto.findUnique({
            where: { codigoProveedor },
          });

          if (dupProveedor) {
            throw new BadRequestException(
              `Ya existe un producto con código de proveedor "${codigoProveedor}"`,
            );
          }
        }

        const costoActualNumber =
          precioCostoActual != null && String(precioCostoActual).trim() !== ''
            ? Number(precioCostoActual)
            : null;

        const tipoInventarioFinal = tipoInventario ?? 'PRODUCTO_VENTA';

        const visibleEnPosFinal =
          tipoInventarioFinal === 'PRODUCTO_VENTA'
            ? Boolean(visibleEnPos ?? true)
            : false;

        const newProduct = await tx.producto.create({
          data: {
            precioCostoActual: costoActualNumber,
            codigoProducto,
            codigoProveedor: codigoProveedor || null,
            nombre,
            descripcion: descripcion || null,

            tipoInventario: tipoInventarioFinal,
            visibleEnPos: visibleEnPosFinal,

            categorias: {
              connect: categorias?.map((id) => ({ id })) ?? [],
            },
          },
        });

        await Promise.all(
          (precioVenta ?? []).map((precio) =>
            tx.precioProducto.create({
              data: {
                productoId: newProduct.id,
                precio: precio.precio,
                estado: 'APROBADO',
                tipo: 'ESTANDAR',
                creadoPorId,
                fechaCreacion: new Date(),
                orden: precio.orden,
                rol: precio.rol,
              },
            }),
          ),
        );

        if (stockMinimo != null) {
          await tx.stockThreshold.create({
            data: {
              productoId: newProduct.id,
              stockMinimo,
            },
          });
        }

        if (imagenes?.length) {
          const uploads = await Promise.allSettled(
            imagenes.map((file) =>
              this.cloudinaryService.subirImagenFile(file),
            ),
          );

          for (let idx = 0; idx < uploads.length; idx++) {
            const result = uploads[idx];
            const file = imagenes[idx];

            if (result.status === 'fulfilled') {
              const { url, public_id } = result.value;

              await this.vincularProductoImagen(
                tx,
                newProduct.id,
                url,
                public_id,
                file?.originalname,
              );
            } else {
              this.logger.error(
                `Error subiendo imagen [${idx}]`,
                result.reason,
              );
            }
          }
        } else {
          this.logger.debug('No hay imágenes de producto para subir/crear');
        }

        return {
          newProduct,
        };
      });
    } catch (error) {
      this.logger.error('Error al crear producto:', error);

      if (error instanceof HttpException) throw error;

      throw new InternalServerErrorException(
        'No se pudo crear el producto y sus datos asociados',
      );
    }
  }

  async vincularProductoImagen(
    tx: Prisma.TransactionClient,
    productoId: number,
    url: string,
    publicId: string,
    altTexto?: string,
  ) {
    return tx.imagenProducto.create({
      data: {
        productoId,
        url,
        public_id: publicId,
        altTexto: altTexto ?? null,
      },
    });
  }

  async findAllProductsToSale(id: number) {
    try {
      const productos = await this.prisma.producto.findMany({
        include: {
          precios: {
            select: {
              id: true,
              precio: true,
              rol: true,
            },
          },
          imagenesProducto: {
            select: {
              id: true,
              url: true,
            },
          },
          stock: {
            where: {
              cantidad: { gt: 0 },
              sucursalId: id,
            },
            select: {
              id: true,
              cantidad: true,
              fechaIngreso: true,
              fechaVencimiento: true,
            },
          },
          presentaciones: {
            include: {
              stockPresentaciones: {
                where: {
                  cantidadPresentacion: { gt: 0 },
                  sucursalId: id,
                },
                select: {
                  id: true,
                  cantidadPresentacion: true,
                  fechaIngreso: true,
                  fechaVencimiento: true,
                },
              },
              precios: {
                select: {
                  id: true,
                  precio: true,
                  rol: true,
                },
              },
            },
          },
        },
      });

      const formattedProducts = productos.map((prod) => ({
        id: prod.id,
        nombre: prod.nombre,
        descripcion: prod.descripcion,
        codigoProducto: prod.codigoProducto,
        creadoEn: prod.creadoEn,
        actualizadoEn: prod.actualizadoEn,
        stock: prod.stock.map((t) => ({
          id: t.id,
          cantidad: t.cantidad,
          fechaIngreso: t.fechaIngreso,
          fechaVencimiento: t.fechaVencimiento,
        })),
        precios: prod.precios.map((p) => ({
          id: p.id,
          precio: p.precio,
          rol: p.rol,
        })),
        imagenesProducto: prod.imagenesProducto.map((img) => ({
          id: img.id,
          url: img.url,
        })),
        presentaciones: prod.presentaciones.map((pres) => ({
          id: pres.id,
          nombre: pres.nombre,
          // sku: pres.sku,
          codigoBarras: pres.codigoBarras,
          // tipoPresentacion: pres.tipoPresentacion,
          precios: pres.precios.map((pp) => ({
            id: pp.id,
            precio: pp.precio,
            rol: pp.rol,
          })),
          stockPresentaciones: pres.stockPresentaciones.map((s) => ({
            id: s.id,
            cantidadPresentacion: s.cantidadPresentacion,
            fechaIngreso: s.fechaIngreso,
            fechaVencimiento: s.fechaVencimiento,
          })),
        })),
      }));

      return formattedProducts;
    } catch (error) {
      this.logger.error('Error en findAll productos:', error);
      throw new InternalServerErrorException('Error al obtener los productos');
    }
  }

  /**
   * Función que retorna y filtra productos para el POS.
   * Usa los mismos filtros base del inventario, pero únicamente trabaja con productos.
   *
   * @param dto
   * @returns PRODUCTOS FILTRADOS PARA UNA TABLA PAGINADA
   */
  async getProductsForPOS(dto: newQueryDTO) {
    try {
      verifyProps<newQueryDTO>(dto, ['sucursalId', 'limit', 'page']);

      const page = Math.max(1, Number(dto.page) || 1);
      const limit = Math.min(Math.max(1, Number(dto.limit) || 20), 100);
      const skip = (page - 1) * limit;

      /**
       * Productos vendibles del POS.
       * Estos sí van paginados y sí reciben filtros/search.
       */
      const whereProducto: Prisma.ProductoWhereInput = {
        activo: true,
        eliminado: false,
        tipoInventario: 'PRODUCTO_VENTA',
        visibleEnPos: true,
      };

      this.asignePropsWhereInput(dto, whereProducto);

      /**
       * Empaques.
       * No los mezclamos con la paginación del POS.
       * No deben depender del search de productos.
       */
      const whereEmpaques: Prisma.ProductoWhereInput = {
        activo: true,
        eliminado: false,
        tipoInventario: 'EMPAQUE',
      };

      const [totalProducts, products, empaquesRaw] = await Promise.all([
        this.prisma.producto.count({
          where: whereProducto,
        }),

        this.prisma.producto.findMany({
          where: whereProducto,
          skip,
          take: limit,
          select: productoSelect,
          orderBy: {
            id: 'asc',
          },
        }),

        this.prisma.producto.findMany({
          where: whereEmpaques,
          select: productoSelect,
          orderBy: {
            nombre: 'asc',
          },
        }),
      ]);

      const productsArray = Array.isArray(products)
        ? this.normalizerProductsInventario(products, dto.sucursalId)
        : [];

      const empaquesArray = Array.isArray(empaquesRaw)
        ? this.normalizerProductsInventario(empaquesRaw, dto.sucursalId)
        : [];

      const totalPages = Math.max(1, Math.ceil(totalProducts / limit));

      return {
        data: productsArray.map((producto) => ({
          ...producto,
          __source: 'producto',
        })),

        empaques: empaquesArray.map((producto) => ({
          ...producto,
          __source: 'empaque',
        })),

        meta: {
          totalCount: totalProducts,
          totalPages,
          page,
          limit,
          totals: {
            productos: totalProducts,
            empaques: empaquesArray.length,
          },
        },
      };
    } catch (error) {
      this.logger.error('Error generado en get productos POS: ', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Fatal Error: Error inesperado en módulo de productos',
      );
    }
  }

  asignePropsWhereInput(dto: newQueryDTO, where: Prisma.ProductoWhereInput) {
    const {
      cats,
      codigoItem,
      codigoProveedor,
      priceRange,
      nombreItem,
      tipoEmpaque,
      sucursalId,
    } = dto;

    if (!dto) throw new BadRequestException('Datos inválidos');

    // ---- 0) Derivar q unificada desde un solo input ----
    const qRaw = (dto as any).q ?? nombreItem ?? codigoItem ?? '';
    const hasUnifiedQ = !!qRaw?.trim();

    // ---- 1) Filtros “ortogonales” que no chocan con q ----
    //Que esté en categorias seleccionadas
    if (Array.isArray(cats) && cats.length > 0) {
      where.categorias = { some: { id: { in: cats } } };
    }
    //Que esté entre los tipos empaques seleccionados
    if (Array.isArray(tipoEmpaque) && tipoEmpaque.length > 0) {
      where.tipoPresentacion = {
        id: { in: tipoEmpaque },
      };
    }
    //BUSCAR STOCK POR SUCURSAL

    if (priceRange != null) {
      if (Array.isArray(priceRange) && priceRange.length === 2) {
        const [min, max] = priceRange;
        where.precios = {
          some: {
            precio: { gte: min ?? 0, lte: max ?? Number.MAX_SAFE_INTEGER },
          },
        };
      } else if (typeof priceRange === 'number') {
        where.precios = { some: { precio: { equals: priceRange } } };
      }
    }

    // ⚠️ 2) Si estoy usando búsqueda unificada, NO dupliques filtros por campo
    if (!hasUnifiedQ) {
      if (codigoItem) {
        where.codigoProducto = { contains: codigoItem, mode: INS };
      }
      if (nombreItem) {
        where.nombre = { contains: nombreItem, mode: INS };
      }
      if (codigoProveedor) {
        where.codigoProveedor = { contains: codigoProveedor, mode: INS };
      }
    } else {
      // Si quieres permitir además un filtro explícito y separado por proveedor (de otro control),
      // déjalo aquí (solo si viene por un campo dedicado distinto al input unificado):
      if (dto.codigoProveedor && dto.q) {
        // opcional: moverlo a OR con el builder si así lo prefieres
      }
    }

    // ---- 3) BÚSQUEDA UNIFICADA (tokens + heurística código) ----
    const toAndArr = (
      x?: Prisma.ProductoWhereInput | Prisma.ProductoWhereInput[],
    ) => (Array.isArray(x) ? x : x ? [x] : []);

    const textSearch = buildSearchForProducto(qRaw);
    if (textSearch) {
      where.AND = [...toAndArr(where.AND), textSearch];
    }

    return where;
  }

  asignePropsWhereInputPresentation(
    dto: newQueryDTO,
    where: Prisma.ProductoPresentacionWhereInput,
  ) {
    const {
      cats,
      codigoItem,
      codigoProveedor,
      priceRange,
      nombreItem,
      tipoEmpaque,
    } = dto;

    if (!dto) throw new BadRequestException('Datos inválidos');

    // ---- 0) q unificada ----
    const qRaw = (dto as any).q ?? nombreItem ?? codigoItem ?? '';
    const hasUnifiedQ = !!qRaw?.trim();

    // ---- 1) Filtros ortogonales ----
    if (Array.isArray(cats) && cats.length > 0) {
      where.producto = { is: { categorias: { some: { id: { in: cats } } } } };
    }
    //Que esté entre los tipos empaques seleccionados
    if (Array.isArray(tipoEmpaque) && tipoEmpaque.length > 0) {
      where.tipoPresentacion = {
        id: { in: tipoEmpaque },
      };
    }

    if (priceRange != null) {
      if (Array.isArray(priceRange) && priceRange.length === 2) {
        const [min, max] = priceRange;
        where.precios = {
          some: {
            precio: { gte: min ?? 0, lte: max ?? Number.MAX_SAFE_INTEGER },
          },
        };
      } else if (typeof priceRange === 'number') {
        where.precios = { some: { precio: { equals: priceRange } } };
      }
    }

    // ⚠️ 2) Evitar doble filtrado si hay q unificada
    if (!hasUnifiedQ) {
      if (codigoItem) {
        where.codigoBarras = { contains: codigoItem, mode: INS };
      }
      if (nombreItem) {
        where.nombre = { contains: nombreItem, mode: INS };
      }
      if (codigoProveedor) {
        where.producto = {
          is: {
            ...(where.producto?.is ?? {}),
            codigoProveedor: { contains: codigoProveedor, mode: INS },
          },
        };
      }
    }

    // ---- 3) BÚSQUEDA UNIFICADA también en Presentación ----
    const toAndArr = (
      x?:
        | Prisma.ProductoPresentacionWhereInput
        | Prisma.ProductoPresentacionWhereInput[],
    ) => (Array.isArray(x) ? x : x ? [x] : []);

    const textSearchPres = buildSearchForPresentacion(qRaw);
    if (textSearchPres) {
      where.AND = [...toAndArr(where.AND), textSearchPres];
    }

    return where;
  }

  async findAll() {
    try {
      const productos = await this.prisma.producto.findMany({
        include: {
          stockThreshold: {
            select: {
              id: true,
              stockMinimo: true,
            },
          },
          precios: {
            select: {
              id: true,
              precio: true,
              tipo: true,
              usado: true,
              orden: true,
              rol: true,
            },
          },
          categorias: {
            select: {
              id: true,
              nombre: true,
            },
          },
          stock: {
            include: {
              sucursal: {
                select: {
                  id: true,
                  nombre: true,
                },
              },
              entregaStock: {
                include: {
                  proveedor: {
                    select: {
                      nombre: true, // Solo seleccionamos el nombre del proveedor
                    },
                  },
                },
              },
            },
            where: {
              cantidad: {
                gt: 0, // Solo traer productos con stock disponible
              },
            },
          },
        },
      });
      return productos;
    } catch (error) {
      console.error('Error en findAll productos:', error); // Proporcionar más contexto en el error
      throw new InternalServerErrorException('Error al obtener los productos');
    }
  }

  async findAllProductsToTransfer(id: number) {
    try {
      const productos = await this.prisma.producto.findMany({
        include: {
          stock: {
            where: {
              cantidad: {
                gt: 0, // Solo traer productos con stock disponible
              },
              sucursalId: id,
            },
          },
        },
      });
      return productos;
    } catch (error) {
      console.error('Error en findAll productos:', error); // Proporcionar más contexto en el error
      throw new InternalServerErrorException('Error al obtener los productos');
    }
  }

  async findAllProductsToStcok() {
    try {
      const productos = await this.prisma.producto.findMany({
        select: {
          id: true,
          nombre: true,
          codigoProducto: true,
        },
        orderBy: {
          actualizadoEn: 'desc',
        },
      });

      return productos;
    } catch (error) {
      console.error('Error en findAll productos:', error); // Proporcionar más contexto en el error
      throw new InternalServerErrorException('Error al obtener los productos');
    }
  }

  async productToEdit(id: number) {
    try {
      console.log('buscando un producto');

      const product = await this.prisma.producto.findUnique({
        where: {
          id,
        },
        include: {
          stockThreshold: true,
          categorias: true,
          imagenesProducto: {
            select: {
              id: true,
              url: true,
              public_id: true,
            },
          },
          precios: {
            select: {
              id: true,
              precio: true,
              orden: true,
              rol: true,
              tipo: true,
            },
          },
        },
      });

      return product;
    } catch (error) {
      console.error('Error en findAll productos:', error); // Proporcionar más contexto en el error
      throw new InternalServerErrorException('Error al obtener los productos');
    }
  }

  async productHistorialPrecios() {
    try {
      const historialPrecios = await this.prisma.historialPrecioCosto.findMany({
        include: {
          modificadoPor: {
            select: {
              nombre: true,
              id: true,
              rol: true,
              sucursal: {
                // Debes hacer include aquí
                select: {
                  nombre: true,
                  id: true,
                  direccion: true,
                },
              },
            },
          },
          producto: true, // Suponiendo que deseas incluir todo el producto
        },
        orderBy: {
          fechaCambio: 'desc',
        },
      });
      return historialPrecios;
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException('Error');
    }
  }

  async productToWarranty() {
    try {
      const products = await this.prisma.producto.findMany({
        orderBy: {
          creadoEn: 'desc',
        },
      });
      return products;
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException('Error al encontrar productos');
    }
  }

  async findOne(id: number) {
    try {
      const producto = await this.prisma.producto.findUnique({
        where: { id },
      });
      return producto;
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException('Error al encontrar el producto');
    }
  }

  async remove(id: number, dto: DeleteProductDto) {
    const { password, userId } = dto;

    const user = await this.prisma.usuario.findUnique({
      where: { id: userId },
      select: {
        id: true,
        contrasena: true,
        rol: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(user.rol);

    if (!isAdmin) {
      throw new UnauthorizedException(
        'Solo un administrador puede eliminar productos',
      );
    }

    const passwordMatches = await brcrypt.compare(password, user.contrasena);

    if (!passwordMatches) {
      throw new UnauthorizedException('Contraseña incorrecta');
    }

    const producto = await this.prisma.producto.findUnique({
      where: { id },
      select: {
        id: true,
        nombre: true,
        codigoProducto: true,
        eliminado: true,
      },
    });

    if (!producto) {
      throw new NotFoundException('Producto no encontrado');
    }

    if (producto.eliminado) {
      throw new BadRequestException('Este producto ya fue eliminado');
    }

    const [ventas, stock, precios, historialStock, compras] = await Promise.all(
      [
        this.prisma.ventaProducto.count({ where: { productoId: id } }),
        this.prisma.stock.count({ where: { productoId: id } }),
        this.prisma.precioProducto.count({ where: { productoId: id } }),
        this.prisma.historialStock.count({ where: { productoId: id } }),
        this.prisma.compraDetalle.count({ where: { productoId: id } }),
      ],
    );

    const dependencias = {
      ventas,
      stock,
      precios,
      historialStock,
      compras,
    };

    const tieneMovimientos = Object.values(dependencias).some(
      (total) => total > 0,
    );

    if (tieneMovimientos) {
      return this.prisma.producto.update({
        where: { id },
        data: {
          activo: false,
          eliminado: true,
          eliminadoEn: new Date(),
          eliminadoPorId: user.id,
          codigoProducto: `${producto.codigoProducto}__ELIMINADO__${producto.id}`,
        },
      });
    }

    return this.prisma.producto.delete({
      where: { id },
    });
  }

  async removeAll() {
    try {
      const productos = await this.prisma.producto.deleteMany({});
      return productos;
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException('Error al eliminar los productos');
    }
  }

  async removePrice(id: number) {
    if (!id) {
      throw new BadRequestException({
        error: 'ID de precio no proporcionado',
      });
    }

    try {
      const priceToDelete = await this.prisma.precioProducto.delete({
        where: { id },
      });

      if (!priceToDelete) {
        throw new InternalServerErrorException({
          message: 'Error al eliminar el precio',
        });
      }

      // ¡Listo, elimina y retorna éxito!
      return {
        message: 'Precio eliminado correctamente',
        price: priceToDelete,
        success: true,
      };
    } catch (error) {
      // Siempre lanza, no retornes el error
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException({
        message: 'Error inesperado',
        details: error,
      });
    }
  }

  async removeImageFromProduct(publicId: string, imageId: number) {
    console.log('el publicId es: ', publicId, ' y el imageId es: ', imageId);

    if (!imageId) {
      throw new MethodNotAllowedException(
        'No se ha proporcionado un ID de imagen',
      );
    }

    if (!publicId) {
      throw new MethodNotAllowedException(
        'No se ha proporcionado un ID de imagen',
      );
    }

    try {
      await this.prisma.imagenProducto.delete({
        where: {
          id: imageId,
        },
      });
      await this.cloudinaryService.BorrarImagen(publicId);
    } catch (error) {
      console.log(error);
    }
  }

  async productToCredit() {
    try {
      const products = await this.prisma.producto.findMany({
        select: {
          id: true,
          nombre: true,
          codigoProducto: true,
        },
      });
      return products;
    } catch (error) {
      console.log(error);
      throw new BadRequestException(
        'Error al conseguir datos de los productos',
      );
    }
  }

  async getBySearchProducts(
    q: string,
    sucursalId: string,
  ): Promise<ProductoApi[]> {
    try {
      let where: Prisma.ProductoWhereInput = {};

      if (q) {
        where.OR = [
          { nombre: { contains: q.trim().toLowerCase(), mode: 'insensitive' } },
          {
            descripcion: {
              contains: q.trim().toLowerCase(),
              mode: 'insensitive',
            },
          },
          {
            codigoProducto: {
              contains: q.trim().toLowerCase(),
              mode: 'insensitive',
            },
          },
          {
            codigoProveedor: {
              contains: q.trim().toLowerCase(),
              mode: 'insensitive',
            },
          },
        ];
      }

      if (sucursalId) {
        where = {
          ...where,
        };
      }

      const productsFind = await this.prisma.producto.findMany({
        where,
        select: {
          id: true,
          nombre: true,
          descripcion: true,
          codigoProducto: true,
          precios: {
            orderBy: { orden: 'desc' },
            select: { id: true, precio: true, rol: true },
          },
          stock: {
            where: { sucursalId: parseInt(sucursalId), cantidad: { gt: 0 } },
            select: { id: true, cantidad: true },
          },
          imagenesProducto: { select: { id: true, url: true } },
          presentaciones: {
            select: {
              id: true,
              nombre: true,
              codigoBarras: true,
              tipoPresentacion: true,
              // sku: true,
              stockPresentaciones: {
                where: {
                  sucursalId: parseInt(sucursalId),
                  cantidadPresentacion: { gt: 0 },
                },
                select: { id: true, cantidadPresentacion: true },
              },
              precios: {
                orderBy: { orden: 'desc' },
                select: { id: true, precio: true, rol: true },
              },
            },
          },
        },
      });

      // === Map Prisma → ProductoApi ===
      const productos: ProductoApi[] = productsFind.map((p) => ({
        id: p.id,
        nombre: p.nombre,
        descripcion: p.descripcion,
        codigoProducto: p.codigoProducto,
        precios: p.precios.map((pr) => ({
          id: pr.id,
          precio: pr.precio.toString(),
          rol: pr.rol,
        })),
        stock: p.stock.map((s) => ({
          id: s.id,
          cantidad: s.cantidad,
        })),
        imagenesProducto: p.imagenesProducto?.map((img) => ({
          id: img.id,
          url: img.url,
        })),
        presentaciones: p.presentaciones.map((pres) => ({
          id: pres.id,
          nombre: pres.nombre,
          // sku: pres.sku,
          codigoBarras: pres.codigoBarras,
          // tipoPresentacion: pres.tipoPresentacion,
          precios: pres.precios.map((pr) => ({
            id: pr.id,
            precio: pr.precio.toString(),
            rol: pr.rol,
          })),
          stockPresentaciones: pres.stockPresentaciones.map((sp) => ({
            id: sp.id,
            cantidad: sp.cantidadPresentacion,
          })),
        })),
      }));

      return productos;
    } catch (error) {
      this.logger.error('Error generado en search productos: ', error);
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Error inesperado al buscar productos',
      );
    }
  }

  async getProductosPresentacionesForInventary(dto: QueryParamsInventariado) {
    try {
      const {
        precio,
        sucursalId,
        categorias,
        codigoProducto,
        fechaVencimiento,
        productoNombre,
        limit,
        page,
        tiposPresentacion,
        q,
      } = dto;
      this.logger.log('nuevo para inventariado');
      const skip = (page - 1) * limit;

      const where: Prisma.ProductoWhereInput = {};
      const wherePresentaciones: Prisma.ProductoPresentacionWhereInput = {};

      const qRaw = (q ?? productoNombre ?? codigoProducto ?? '').trim();
      const hasUnifiedQ = !!qRaw;

      where.activo = {
        equals: true,
      };

      if (categorias && categorias.length > 0) {
        where.categorias = { some: { id: { in: categorias } } };
        wherePresentaciones.producto = {
          is: {
            ...(wherePresentaciones.producto?.is ?? {}),
            categorias: { some: { id: { in: categorias } } },
          },
        };
      }

      if (tiposPresentacion && tiposPresentacion.length > 0) {
        where.tipoPresentacion = {
          id: {
            in: tiposPresentacion,
          },
        };
        wherePresentaciones.tipoPresentacion = {
          id: {
            in: tiposPresentacion,
          },
        };
      }

      if (fechaVencimiento) {
        // ojo: esto exige que exista stock con esa fecha
        where.stock = { some: { fechaVencimiento: fechaVencimiento as any } };
        wherePresentaciones.stockPresentaciones = {
          some: { fechaVencimiento: { equals: fechaVencimiento as any } },
        };
      }

      if (precio) {
        where.precios = { some: { precio: { equals: precio as any } } };
        wherePresentaciones.precios = {
          some: { precio: { equals: precio as any } },
        };
      }

      // ---- Evita doble filtro por nombre/código cuando usamos q ----
      if (!hasUnifiedQ) {
        if (productoNombre) {
          where.nombre = { contains: productoNombre, mode: 'insensitive' };
          wherePresentaciones.nombre = {
            contains: productoNombre,
            mode: 'insensitive',
          };
        }
        if (codigoProducto) {
          where.codigoProducto = {
            equals: codigoProducto,
            mode: 'insensitive',
          };
          wherePresentaciones.codigoBarras = {
            contains: codigoProducto,
            mode: 'insensitive',
          };
        }
      }

      // ---- Aplica búsqueda unificada (igual que en POS) ----
      const addAnd = <T extends { AND?: any }>(dst: T, clause?: any) => {
        if (!clause) return;
        const current = dst.AND;
        dst.AND = Array.isArray(current)
          ? [...current, clause]
          : current
            ? [current, clause]
            : [clause];
      };

      addAnd(where, buildSearchForProducto(qRaw));
      addAnd(wherePresentaciones, buildSearchForPresentacion(qRaw));

      this.logger.debug(
        'INV WHERE Producto => ' + JSON.stringify(where, null, 2),
      );
      this.logger.debug(
        'INV WHERE Presentación => ' +
          JSON.stringify(wherePresentaciones, null, 2),
      );

      const [productos, presentaciones, totalProductos, totalPresentaciones]: [
        ProductoWithSelect[],
        PresentacionWithSelect[],
        number,
        number,
      ] = await Promise.all([
        this.prisma.producto.findMany({
          where: where,
          select: productoSelect,
          skip: skip,
          take: limit,
        }),
        this.prisma.productoPresentacion.findMany({
          where: wherePresentaciones,
          select: presentacionSelect,
          skip: skip,
          take: limit,
        }),
        //TOTALES PARA META DEL TABLE
        this.prisma.producto.count({ where }),
        this.prisma.productoPresentacion.count({ where: wherePresentaciones }),
      ]);

      //----> prorrateo

      const productosArray = Array.isArray(productos)
        ? this.normalizerProductsInventario(productos, sucursalId)
        : [];

      const presentacionesArray = Array.isArray(presentaciones)
        ? this.normalizerProductPresentacionInventario(
            presentaciones,
            sucursalId,
          )
        : [];

      // DATOS META PARA LA TABLE====>
      const mixed = [...productosArray, ...presentacionesArray];
      const totalCount = totalProductos + totalPresentaciones;
      const totalPages = Math.ceil(totalCount / limit);
      return {
        data: mixed,
        meta: {
          totalCount,
          totalPages,
          page,
          limit,
        },
      };
    } catch (error) {
      this.logger.error(
        'El error generado en get de productos y presentaciones es: ',
        error,
      );
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Fatal error: Error inesperado en servicio de inventariado',
      );
    }
  }

  // HELPERS =======================>
  normalizerProductsInventario(
    arrayProductos: ProductoWithSelect[],
    sucursalId?: number,
  ): ProductoInventarioResponse[] {
    return arrayProductos.map((p) => {
      const toLite = (s: (typeof p.stock)[number]) => {
        const qty = Number(s.cantidad ?? 0);

        const detalles = (s.prorrateoDetalles ?? []).sort(
          (a, b) => dayjs(b.creadoEn).valueOf() - dayjs(a.creadoEn).valueOf(),
        );
        const vigente = detalles[0];

        const stockCost = Number(s.precioCosto ?? NaN);
        const costoUnitario = Number.isFinite(stockCost)
          ? stockCost
          : Number(vigente?.costoUnitarioResultante ?? 0);

        const prorrateoInfo = detalles.map((pro) => ({
          id: pro.id,
          creadoEn: pro.creadoEn,
          costoFacturaUnitario: pro.costoFacturaUnitario,
          costoProrrateadoTotalInversion: pro.costoProrrateadoTotalInversion,
          costoUnitarioProrrateado: pro.costoUnitarioProrrateado,
          costoUnitarioResultante: pro.costoUnitarioResultante,
          existenciasPrevias: pro.existenciasPrevias,
          gastoUnitarioAplicado: pro.gastoUnitarioAplicado,
          gastoUnitarioBase: pro.gastoUnitarioBase,
          inversionLinea: pro.inversionLinea,
          inversionPrevias: pro.inversionPrevias,
          nuevasExistencias: pro.nuevasExistencias,
        }));

        return {
          id: s.id,
          cantidad: qty,
          fechaIngreso: s.fechaIngreso
            ? dayjs(s.fechaIngreso).format('DD-MM-YYYY')
            : '',
          fechaVencimiento: s.fechaVencimiento
            ? dayjs(s.fechaVencimiento).format('DD-MM-YYYY')
            : '',
          costoUnitario,
          prorrateo: prorrateoInfo,
        };
      };

      const precios: PrecioProductoNormalized[] = (p.precios ?? []).map(
        (pr) => ({
          id: pr.id,
          orden: pr.orden,
          precio: pr.precio.toString(),
          rol: pr.rol,
          tipo: pr.tipo,
        }),
      );

      const stocksAll: StocksProducto[] = (p.stock ?? []).map(toLite);

      const stocksSucursal: StocksProducto[] = (p.stock ?? [])
        .filter((s) => (sucursalId ? s.sucursal?.id === sucursalId : true))
        .map(toLite);

      const dict = (p.stock ?? []).reduce<Record<string, StockPorSucursal>>(
        (acc, s) => {
          const sid = s.sucursal?.id ?? 0;
          const key = String(sid);
          const nombre = s.sucursal?.nombre ?? key;
          const item = acc[key] ?? { sucursalId: sid, nombre, cantidad: 0 };
          item.cantidad += Number(s.cantidad ?? 0);
          acc[key] = item;
          return acc;
        },
        {},
      );
      const stocksBySucursal: StocksBySucursal = Object.values(dict);

      return {
        id: p.id,
        nombre: p.nombre,
        codigoProducto: p.codigoProducto ?? '',
        descripcion: p.descripcion ?? '',
        precioCosto:
          p.precioCostoActual != null ? p.precioCostoActual.toString() : '0',
        precios,
        stocks: stocksSucursal,
        stocksAll,
        stocksBySucursal,
        image: p?.imagenesProducto?.[0]?.url,
        images: p?.imagenesProducto,
        type: 'PRODUCTO',
        productoId: p.id,
      };
    });
  }

  normalizerProductPresentacionInventario(
    arrayProductos: PresentacionWithSelect[],
    sucursalId?: number,
  ): ProductoInventarioResponse[] {
    return (arrayProductos ?? []).map((p) => {
      const stockPres = p.stockPresentaciones ?? [];

      // -----> LOTES (sin prorrateo)
      const toLite = (s: (typeof stockPres)[number]) => {
        const qty = Number(s.cantidadPresentacion ?? 0);

        const prorrateoInfo = s.prorrateoDetalles
          .map((pro) => {
            return {
              id: pro.id,
              creadoEn: pro.creadoEn,
              costoFacturaUnitario: pro.costoFacturaUnitario,
              costoProrrateadoTotalInversion:
                pro.costoProrrateadoTotalInversion,
              costoUnitarioProrrateado: pro.costoUnitarioProrrateado,
              costoUnitarioResultante: pro.costoUnitarioResultante,
              existenciasPrevias: pro.existenciasPrevias,
              gastoUnitarioAplicado: pro.gastoUnitarioAplicado,
              gastoUnitarioBase: pro.gastoUnitarioBase,
              inversionLinea: pro.inversionLinea,
              inversionPrevias: pro.inversionPrevias,
              nuevasExistencias: pro.nuevasExistencias,
            };
          })
          .sort(
            (a, b) => dayjs(b.creadoEn).valueOf() - dayjs(a.creadoEn).valueOf(),
          );

        return {
          id: s.id,
          cantidad: qty,
          fechaIngreso: s.fechaIngreso
            ? dayjs(s.fechaIngreso).format('DD-MM-YYYY')
            : '',
          fechaVencimiento: s.fechaVencimiento
            ? dayjs(s.fechaVencimiento).format('DD-MM-YYYY')
            : '',
          costoUnitario: Number(s.precioCosto ?? 0), //  50/45 para UI
          prorrateo: prorrateoInfo,
        };
      };

      const precios: PrecioProductoNormalized[] = (p.precios ?? []).map(
        (pr) => ({
          id: pr.id,
          orden: pr.orden,
          precio: pr.precio?.toString?.() ?? '0',
          rol: pr.rol,
          tipo: pr.tipo,
        }),
      );

      const stocksAll: StocksProducto[] = stockPres.map(toLite);

      const stocksSucursal: StocksProducto[] = stockPres
        .filter((s) => (sucursalId ? s.sucursal?.id === sucursalId : true))
        .map(toLite);

      const dict = stockPres.reduce<Record<string, StockPorSucursal>>(
        (acc, s) => {
          const sid = s.sucursal?.id ?? 0;
          const key = String(sid);
          const nombre = s.sucursal?.nombre ?? key;
          const item = acc[key] ?? { sucursalId: sid, nombre, cantidad: 0 };
          item.cantidad += Number(s.cantidadPresentacion ?? 0);
          acc[key] = item;
          return acc;
        },
        {},
      );
      const stocksBySucursal: StocksBySucursal = Object.values(dict);

      const images = p.producto?.imagenesProducto ?? [];
      const image = images[0]?.url ?? '';

      return {
        id: p.id,
        nombre: p.nombre,
        codigoProducto: p.codigoBarras ?? '',
        descripcion: p.descripcion ?? '',
        precioCosto:
          p.costoReferencialPresentacion != null
            ? p.costoReferencialPresentacion.toString()
            : '0',
        tipoPresentacion: p.tipoPresentacion ?? null,
        precios,
        stocks: stocksSucursal,
        stocksAll,
        stocksBySucursal,
        image,
        images,
        type: 'PRESENTACION',
        productoId: p.producto.id,
      };
    });
  }

  //SERVICIOS DE EDICION DE PRODUCTO - GET Y PATCH
  async getProductToEdit(productId: number) {
    try {
      if (!productId) throw new BadRequestException('Id de producto no válido');
      const product = await this.prisma.producto.findUnique({
        where: { id: productId },
      });
    } catch (error) {
      this.logger.error('Error en módulo de productos-get edición: ', error);
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Fatal error: Error inesperado');
    }
  }

  //EDICION Y GET DE PRODUCTO
  async getProductDetail(id: number) {
    const p = await this.prisma.producto.findUnique({
      where: { id },
      include: {
        categorias: true,
        imagenesProducto: true,
        precios: {
          orderBy: { orden: 'asc' },
          where: {
            estado: 'APROBADO',
            OR: [
              { tipo: { not: 'CREADO_POR_SOLICITUD' } },
              {
                AND: [{ tipo: 'CREADO_POR_SOLICITUD' }, { usado: false }],
              },
            ],
          },
        },
        stockThreshold: {
          select: {
            stockMinimo: true,
          },
        },
      },
    });

    if (!p) {
      throw new NotFoundException('Producto no encontrado');
    }

    const data = {
      id: p.id,
      nombre: p.nombre,
      codigoProducto: p.codigoProducto,
      codigoProveedor: p.codigoProveedor,
      descripcion: p.descripcion,

      // NUEVO: flags operativas
      tipoInventario: p.tipoInventario,
      visibleEnPos: p.visibleEnPos,

      // Mejor como número para el input
      precioCostoActual: Number(p.precioCostoActual ?? 0),

      stockMinimo: p.stockThreshold?.stockMinimo ?? 0,

      categorias: p.categorias.map(({ id, nombre }) => ({
        id,
        nombre,
      })),

      imagenesProducto: p.imagenesProducto.map((i) => ({
        id: i.id,
        url: i.url,
        public_id: i.public_id,
        name: i.altTexto ?? null,
      })),

      precios: p.precios.map((x) => ({
        rol: x.rol,
        orden: x.orden,
        precio: this.dec(x.precio),
      })),
    };

    this.logger.log(
      `La data a retornar al formulario de edicion de producto es:\n${JSON.stringify(data, null, 2)}`,
    );

    return data;
  }

  // Sube y guarda imágenes de PRODUCTO en Cloudinary y luego en Prisma.
  // Si el insert en la DB fallara, elimina en Cloudinary lo que ya subiste (compensación).
  // ================== HELPERS IMÁGENES ==================

  /** Sube imágenes de PRODUCTO a Cloudinary y las persiste en Prisma.
   * Si el insert falla, borra en Cloudinary (compensación). */
  private async uploadAndSaveProductImages(
    tx: Prisma.TransactionClient,
    productoId: number,
    files: Express.Multer.File[],
  ) {
    if (!files?.length) return;

    const uploads = await Promise.allSettled(
      files.map((file) => this.cloudinaryService.subirImagenFile(file)),
    );

    const ok = uploads
      .map((r, i) => ({ r, file: files[i] }))
      .filter(
        (
          x,
        ): x is {
          r: PromiseFulfilledResult<{ url: string; public_id: string }>;
          file: Express.Multer.File;
        } => x.r.status === 'fulfilled',
      );

    const fail = uploads
      .map((r, i) => ({ r, file: files[i] }))
      .filter(
        (x): x is { r: PromiseRejectedResult; file: Express.Multer.File } =>
          x.r.status === 'rejected',
      );

    if (fail.length) {
      this.logger.warn(
        `[uploadAndSaveProductImages] ${fail.length} upload(s) fallidos: ${fail
          .map((f) => f.file.originalname)
          .join(', ')}`,
      );
    }

    if (!ok.length) return;

    try {
      await tx.imagenProducto.createMany({
        data: ok.map(({ r, file }) => ({
          productoId,
          url: r.value.url,
          public_id: r.value.public_id,
          altTexto: file.originalname ?? null,
        })),
      });
    } catch (e) {
      // compensación
      await Promise.allSettled(
        ok.map(({ r }) =>
          this.cloudinaryService.BorrarImagen(r.value.public_id),
        ),
      );
      throw e;
    }
  }

  /** Sube imágenes de PRESENTACIÓN a Cloudinary y las persiste en Prisma. */
  private async uploadAndSavePresentationImages(
    tx: Prisma.TransactionClient,
    presentacionId: number,
    files: Express.Multer.File[],
  ) {
    if (!files?.length) return;

    const uploads = await Promise.allSettled(
      files.map((file) => this.cloudinaryService.subirImagenFile(file)),
    );

    const ok = uploads
      .map((r, i) => ({ r, file: files[i] }))
      .filter(
        (
          x,
        ): x is {
          r: PromiseFulfilledResult<{ url: string; public_id: string }>;
          file: Express.Multer.File;
        } => x.r.status === 'fulfilled',
      );

    const fail = uploads
      .map((r, i) => ({ r, file: files[i] }))
      .filter(
        (x): x is { r: PromiseRejectedResult; file: Express.Multer.File } =>
          x.r.status === 'rejected',
      );

    if (fail.length) {
      this.logger.warn(
        `[uploadAndSavePresentationImages] ${fail.length} upload(s) fallidos: ${fail
          .map((f) => f.file.originalname)
          .join(', ')}`,
      );
    }

    if (!ok.length) return;

    try {
      await tx.imagenPresentacion.createMany({
        data: ok.map(({ r, file }) => ({
          presentacionId,
          url: r.value.url,
          public_id: r.value.public_id,
          altTexto: file.originalname ?? null,
          orden: 0,
        })),
      });
    } catch (e) {
      await Promise.allSettled(
        ok.map(({ r }) =>
          this.cloudinaryService.BorrarImagen(r.value.public_id),
        ),
      );
      throw e;
    }
  }

  // ================== UPDATE (DROP-IN) ==================

  async update(
    productId: number,
    dto: {
      nombre: string;
      descripcion: string | null;
      codigoProducto: string;
      codigoProveedor: string | null;
      stockMinimo: number | null;
      precioCostoActual: string | null;
      creadoPorId: number;
      categorias: number[];
      precioVenta: { rol: RolPrecio; orden: number; precio: string }[];

      tipoInventario: TipoProductoInventario;
      visibleEnPos: boolean;

      keepProductImageIds?: number[];
    },
    productImages: Express.Multer.File[],
  ) {
    this.logger.log(
      `DTO recibido para editar producto:\n${JSON.stringify(dto, null, 2)}`,
    );

    this.logger.debug(`[update] productImages=${productImages.length}`);

    return this.prisma.$transaction(async (tx) => {
      // 1) Existencia
      const exists = await tx.producto.findUnique({
        where: { id: productId },
        select: {
          id: true,
          codigoProducto: true,
          codigoProveedor: true,
        },
      });

      if (!exists) {
        throw new NotFoundException('Producto no encontrado');
      }

      // 2) Validar código producto duplicado
      if (dto.codigoProducto && dto.codigoProducto !== exists.codigoProducto) {
        const dupCodigoProducto = await tx.producto.findFirst({
          where: {
            codigoProducto: dto.codigoProducto,
            id: { not: productId },
          },
          select: { id: true },
        });

        if (dupCodigoProducto) {
          throw new BadRequestException(
            `Ya existe otro producto con código "${dto.codigoProducto}"`,
          );
        }
      }

      // 3) Validar código proveedor duplicado, solo si viene
      if (
        dto.codigoProveedor &&
        dto.codigoProveedor !== exists.codigoProveedor
      ) {
        const dupCodigoProveedor = await tx.producto.findFirst({
          where: {
            codigoProveedor: dto.codigoProveedor,
            id: { not: productId },
          },
          select: { id: true },
        });

        if (dupCodigoProveedor) {
          throw new BadRequestException(
            `Ya existe otro producto con código de proveedor "${dto.codigoProveedor}"`,
          );
        }
      }

      const costoActualNumber =
        dto.precioCostoActual != null &&
        String(dto.precioCostoActual).trim() !== ''
          ? Number(dto.precioCostoActual)
          : null;

      const tipoInventarioFinal =
        dto.tipoInventario ?? TipoProductoInventario.PRODUCTO_VENTA;

      const visibleEnPosFinal =
        tipoInventarioFinal === TipoProductoInventario.PRODUCTO_VENTA
          ? Boolean(dto.visibleEnPos ?? true)
          : false;

      // 4) Update producto base
      await tx.producto.update({
        where: { id: productId },
        data: {
          nombre: dto.nombre,
          descripcion: dto.descripcion || null,
          codigoProducto: dto.codigoProducto,
          codigoProveedor: dto.codigoProveedor || null,
          precioCostoActual: costoActualNumber,

          tipoInventario: tipoInventarioFinal,
          visibleEnPos: visibleEnPosFinal,

          categorias: {
            set: dto.categorias.map((id) => ({ id })),
          },
        },
      });

      // 5) Stock mínimo del producto
      if (dto.stockMinimo === null) {
        await tx.stockThreshold.deleteMany({
          where: { productoId: productId },
        });
      } else {
        const current = await tx.stockThreshold.findFirst({
          where: { productoId: productId },
          select: { id: true },
        });

        if (current) {
          await tx.stockThreshold.update({
            where: { id: current.id },
            data: { stockMinimo: dto.stockMinimo },
          });
        } else {
          await tx.stockThreshold.create({
            data: {
              productoId: productId,
              stockMinimo: dto.stockMinimo,
            },
          });
        }
      }

      // 6) Precios del producto - versionado
      await tx.precioProducto.updateMany({
        where: {
          productoId: productId,
          estado: EstadoPrecio.APROBADO,
          vigenteHasta: null,
        },
        data: {
          estado: EstadoPrecio.RECHAZADO,
          vigenteHasta: new Date(),
        },
      });

      if (dto.precioVenta?.length) {
        await tx.precioProducto.createMany({
          data: dto.precioVenta.map((p) => ({
            productoId: productId,
            rol: p.rol,
            orden: p.orden,
            precio: new Prisma.Decimal(p.precio),
            tipo: TipoPrecio.ESTANDAR,
            estado: EstadoPrecio.APROBADO,
            vigenteDesde: new Date(),
            vigenteHasta: null,
            creadoPorId: dto.creadoPorId,
          })),
        });
      }

      // 7) Imágenes del producto
      // Solo borra si el frontend envía keepProductImageIds.
      // Si no lo envía, no tocamos las imágenes existentes.
      if (Array.isArray(dto.keepProductImageIds)) {
        const existingImages = await tx.imagenProducto.findMany({
          where: { productoId: productId },
          select: {
            id: true,
            public_id: true,
          },
        });

        const keepSet = new Set(dto.keepProductImageIds);

        const imagesToDelete = existingImages.filter(
          (img) => !keepSet.has(img.id),
        );

        if (imagesToDelete.length) {
          await Promise.allSettled(
            imagesToDelete
              .filter((img) => !!img.public_id)
              .map((img) =>
                this.cloudinaryService.BorrarImagen(img.public_id!),
              ),
          );

          await tx.imagenProducto.deleteMany({
            where: {
              id: {
                in: imagesToDelete.map((img) => img.id),
              },
            },
          });
        }
      }

      // 8) Subir nuevas imágenes del producto
      await this.uploadAndSaveProductImages(tx, productId, productImages);

      return {
        ok: true,
        id: productId,
        tipoInventario: tipoInventarioFinal,
        visibleEnPos: visibleEnPosFinal,
      };
    });
  }
}
