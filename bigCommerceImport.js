const lodash = require("lodash");
const fs = require('fs')
const axios = require("axios");
const Util = require('./util');

class bigCommerceImport {
    constructor() {
        let bigCommerceAuthTokens = [
            process.env.BIG_COMMERCE_AUTH_TOKEN_1,
            process.env.BIG_COMMERCE_AUTH_TOKEN_2,
            process.env.BIG_COMMERCE_AUTH_TOKEN_3,
            process.env.BIG_COMMERCE_AUTH_TOKEN_4
        ];
        let min = 0;
        let max = bigCommerceAuthTokens.length - 1;
        let rand = Math.round(min + Math.random() * (max - min));
        let authToken = bigCommerceAuthTokens[rand];

        this.bigCommerceKey = process.env.BIG_COMMERCE_STORE_KEY/*"hk9eg6jqxb"*/;
        const bigCommerceDomain = `https://api.bigcommerce.com/stores/${this.bigCommerceKey}/v3`;
//create axios with authorization on BigCommerce
        this.instanceAxios = axios.create({
            baseURL: bigCommerceDomain,
            headers: {
                "X-Auth-Token": authToken/*"738kl54y7swkyepcszqy121pne6d1xe"*/,
                "User-Agent": "PostmanRuntime/7.29.0",
                "Accept": "*/*",
                "Content-Type": "application/json"
            },
        });
        this.countCreate = 0;
        this.countUpdate = 0;
    }

    //Get product by sku in BC (only product)
    async getProductBySkuBC (sku) {
        const res = await this.instanceAxios.get(`catalog/products?sku=${sku}`);
        return res.data.data.length !== 0 ? res.data.data[0] : null;
    }


    //Get variant by sku in BC (product and variant cause product without variations will be count a variant)
    async getProductVariantBySkuBC (sku) {
        const res = await this.instanceAxios.get(`catalog/variants?sku=${sku}`);
        return res.data.data.length !== 0 ? res.data.data[0] : null;
    }


    //import category
    async importCategory(product) {
        const categories = []
        await Promise.all(product.categories.map(async e => {
            let name = e.name.replace(/\&/g, '%26')
            //Because BestBuy only provide name of category so need to search category name
            const res = await this.instanceAxios.get(`catalog/categories?name=${name}`);
            //If no category found start create new category
            if (res.data.data.length === 0) {
                try {
                    const category = await this.instanceAxios.post(`catalog/categories`, {
                        name: e.name,
                        parent_id: 0
                    });
                    categories.push(category.data.data.id)
                } catch (err) {
                    //It mean category is existed
                    if (err.response && (err.response.data.status == 422 || err.response.data.status == 422)) {
                    } else {
                        throw err
                    }
                }
            } //If had category add that category to list category of product
            else {
                categories.push(res.data.data[0].id)
            }
        }))

        return categories
    }


    //Format size on BestBuy have a lot of type but Bigcommerce only take a number so need to transform and calculate numbẻ
    formatSize(string){
        if (string && isNaN(string)) {
            string = string.replace(/[`~!@#$%^&*()_|+\-=?;:'",<>\{\}\[\]\\]/gi, '')
            if (string.includes('inches')) {
                return Number(string.split(" ")[0]) +
                    Number(string.split(" ")[1].split("/")[0] / string.split(" ")[1].split("/")[1])
            }
            if (string.includes('pounds')) {
                return Number(string.split(" ")[0])
            }
            if (string.includes('/')) {
                return string.split('/')[0] / string.split('/')[1];
            }
            return string.toString().split(' ')[0]
        } return string || undefined
    }


    //Main Service on import data
    //Read data exported from excel and read each sku (cant use parallel create because lots of sku is variation of other product)
    async importData() {
        this.countCreate = 0;
        this.countUpdate = 0;

        //read data
        let jsonPath = "./json/";
        fs.readdir("./json/", (err, files) => {
            files.forEach(async(file, i) => {
                // if(i>0) return;
                if(file.indexOf(".json") > -1){
                    let index = 0;
                    let jsonData = JSON.parse(fs.readFileSync(jsonPath + file))
                    if(lodash.isObject(jsonData)){
                        console.log("Import");
                        await this.importProductToBigCommerce(jsonData);
                    }else if(lodash.isArray(jsonData)){
                        //Read 20 product pertime to increase performance
                        const count = Math.ceil(jsonData.length / 20);
                        //read from index * 20 to  index * 20 + 20 and continue to the end of file
                        console.log(index, count);
                        while (index < count) {
                            const products = jsonData.slice(index * 20, index * 20 + 20);
                            // //With response start import each product
                            products.forEach((product, i) => {
                                this.importProductToBigCommerce(product);
                            });
                            index++;
                        }
                    }

                }
            });
        });

        return {
            countCreate: this.countCreate,
            countUpdate: this.countUpdate,
        };
    };


    checkCustomFieldsExist(name, customFieldsArr) {
        if(customFieldsArr === undefined) return false;
        let id = false;
        customFieldsArr.data.forEach(function(custom_field){
            if(name == custom_field.name){
                id = custom_field.id;
            }
        });
        return id;
    }


    checkImageExist(alt, imagesArr) {
        if(imagesArr === undefined) return false;
        let id = false;
        imagesArr.data.forEach(function(image){
            if(alt == image.description){
                id = image.id;
            }
        });
        return id;
    }


    checkOptionExist(name, optionsArr) {
        if(optionsArr === undefined) return false;
        let id = false;
        optionsArr.data.forEach(function(option){
            if(name == option.display_name.toLowerCase()){
                id = option.id;
            }
        });
        return id;
    }

    async importProductToBigCommerce(product) {
        console.log("Before create product " + product.sku);
        //check with this sku has any variant found
        // if (await getProductVariantBySkuBC(product.sku)) {
        //     console.log(`Import product but had existed like variation with sku ${product.sku}\n`)
        //     return;
        // }
        //check with this sku has any product found
        let errorText = "";
        let productBC = await this.getProductBySkuBC(product.sku);
        let data = {
            name: product.name,
            sku: product.sku.toString(),
            type: "physical",
            description: product.description || "",
            weight: this.convertWeight(product.weight) || 0,
            width: this.formatSize(product.width) || undefined,
            depth: this.formatSize(product.depth) || undefined,
            height: this.formatSize(product.height) || undefined,
            price: product.price || 0,
            cost_price: product.cost || 0,
            // sale_price: getPriceProductBB(product.cost || product.regularPrice, product.weight || product.shippingWeight),
            // map_price: getPriceProductBB(product.salePrice || product.regularPrice, product.weight || product.shippingWeight),
            // reviews_rating_sum: Number(product.customerReviewAverage * 10),
            // reviews_count: product.customerReviewCount || 0,
            categories: await this.importCategory(product),
            brand_name: product.vendor ? product.vendor : 'Uncategorized',
            is_visible: true,
            availability: product.published ? "available" : "disabled",
            //If has variation inventory tracking will be variant,
            inventory_tracking: "variant",
            inventory_level: product.variants.length == 0 ? 100 : undefined,
            //Import images but now not use because conflict size of image
            images: await this.importImagesToBigCommerce(product),
            //import custom field
            custom_fields: await this.importCustomFieldToBigCommerce(product),
        };

        let BCproduct;
        if(productBC !== null){
            let custom_fields = data.custom_fields;
            let images = data.images;
            delete data.custom_fields;
            delete data.images;
            try {
                data.id = productBC.id;
                BCproduct = await this.instanceAxios.put(`catalog/products/${productBC.id}`, data);
                errorText = "";
            } catch (err) {
                console.log(err);
                errorText = err.response.data.title;
                throw err
            }
            let BCproductCustomFields = await this.instanceAxios.get(`catalog/products/${productBC.id}/custom-fields`);

            custom_fields.forEach((custom_field) => {
                let id = this.checkCustomFieldsExist(custom_field.name, BCproductCustomFields.data);
                if(id !== false){
                    custom_field.id = id;
                    try{
                        this.instanceAxios.put(`catalog/products/${productBC.id}/custom-fields/${id}`, custom_field);
                    } catch (err) {
                        console.log(err);
                        throw err
                    }
                }else{
                    try{
                        this.instanceAxios.post(`catalog/products/${productBC.id}/custom-fields`, custom_field);
                    } catch (err) {
                        console.log(err);
                        throw err
                    }
                }
            });

            let BCproductImages = await this.instanceAxios.get(`catalog/products/${productBC.id}/images`);
            images.forEach((image) => {
                let id = this.checkImageExist(image.description, BCproductImages.data);
                if(id === false){
                    try{
                        image.product_id = productBC.id;
                        this.instanceAxios.post(`catalog/products/${productBC.id}/images`, image);
                    } catch (err) {
                        console.log(err);
                        throw err
                    }
                }
            });
        }else{
            try {
                BCproduct = await this.instanceAxios.post(`catalog/products`, data);
                errorText = "";
            } catch (err) {
                //If Name is duplicate will add extra sku to name and create again
                if (err.response && err.response.data.title == "The product name is a duplicate") {
                    data.name = product.name + " " + product.sku
                    BCproduct = await this.instanceAxios.post(`catalog/products`, data);
                    errorText = "";
                } else {
                    console.log(err);
                    errorText = err.response.data.title;
                    throw err
                }
            }
        }
        //add variation
        await this.importVariantOnProduct(BCproduct.data.data.id, product, data.categories);
        this.countCreate++;

        if(errorText == ""){
            let msg = [];
            msg.push('*Imported product*: ' + product.sku);
            msg.push('*Product*: ' + product.name);
            msg.push('*BigCommerce Admin Url*: https://store-'+this.bigCommerceKey+'.mybigcommerce.com/manage/products/edit/' + BCproduct.data.data.id);
            msg.push('*BigCommerce Public Url*: ' + BCproduct.data.data.custom_url.url);
            msg.push('*Num variations*: ' + product.variants.length);
            msg.push('*Environment*: ' + process.env.APP_ENV);
            await Util.slack(msg.join('\n'));
        }else{
            let msg = [];
            msg.push('*Error: Product Import Failure*: ' + product.sku);
            msg.push('*Error*: ' + errorText);
            msg.push('*Environment*: ' + process.env.APP_ENV);
            await Util.slack(msg.join('\n'));
        }


        console.log("Create successfuly");

        console.log("index: " + (this.countCreate + this.countUpdate));
        //wait 1 second
        await this.a();
    }

    //Not use anymore
    async importImagesToBigCommerce(product) {
        const images = [];
        await Promise.all(
            product.images.slice(0, 20).map(async (e) => {
                let url = e.src
                try {
                    await axios.get(url);
                    images.push({
                        image_url: e.src,
                        is_thumbnail: e.position === 1 ? true : false,
                        description: e.alt,
                    });
                } catch (err) {
                    fs.appendFileSync(`log/imagessu.txt`, `${product.sku}, `, err => {
                        if (err) {
                            console.error(err)
                        }
                    })
                }
            })
        );

        return images;
    }


    //By the name of method
    async importCustomFieldToBigCommerce(product) {
        const customFields = [];
        const fields = [
            "shippingCost",
            "shipping",
            //"shippingLevelsOfService",
            "modelNumber",
            "dollarSavings",
            "percentSavings",
        ];
        await Promise.all(
            fields.map((e) => {
                if(product[e]){
                    customFields.push({
                        name: e,
                        value: JSON.stringify(product[e]),
                    });
                }
            })
        );

        customFields.push({
            name: 'supplier',
            value: product.supplier
        })

        return customFields;
    }

    async a() {
        return new Promise(resolve => setTimeout(resolve, 1000));
    }


    async importVariantOnProduct(id, product, categories) {
        //If dont have any vartiation return
        if (product.variants.length == 0) {
            console.log("Dont have variation on this products\n");
            return;
        }

        //Create product option to product
        await this.importVariantOption(id, product)

        //Get product option created before
        const optionOnProduct = await this.instanceAxios.get(`catalog/products/${id}/options`);

        //To avoid exceed request on BestBuy, process each time 20 variation, co
        let count = Math.ceil(product.variants.length / 20);
        let start = 0;
        for (let i = 0; i < count; i++) {
            //process create 20 variation one time
            await Promise.all(product.variants.slice(start, start + 20).map(async e => {
                //variation had existed
                let variant = await this.getProductVariantBySkuBC(e.sku);
                //If  variation with this sku is not existed anymore do nothing
                let data = {
                        name: product.name,
                        sku: e.sku.toString(),
                        type: "physical",
                        description: product.description,
                        weight: this.convertWeight(e.weight) || 0,
                        width: e.width || undefined,
                        depth: e.depth || undefined,
                        height: e.height || undefined,
                        length: e.length || undefined,
                        price: e.price || 0,
                        cost_price: e.cost || 0,
                        sale_price: e.sale_price || e.price || 0,
                        map_price: e.sale_price || e.price || 0,
                        // reviews_rating_sum: Number(productBB.customerReviewAverage * 10),
                        // reviews_count: productBB.customerReviewCount,
                        categories: categories,
                        brand_name: product.vendor ? product.vendor : 'Uncategorized',
                        inventory_level: 100,
                        availability: product.in_stock ? "available" : "disabled",
                        // images: await importImagesToBigCommerce(productBB),
                        custom_fields: await this.importCustomFieldToBigCommerce(product),
                        option_values: await this.importOptionValues(optionOnProduct.data.data, e, product)
                };
                //  console.log(await getProductBySkuBC(productBB.sku));
                //I see some variation on a product dont have option so cant import that sku

                if(variant !== null){
                    try {
                        data.id = variant.id;
                        await this.instanceAxios.put(`catalog/products/${id}/variants/${variant.id}`, data);
                        console.log(`Done Update Variation with sku: ${data.sku}`)
                    } catch (error) {
                        console.log(error);
                        throw error;
                    }
                }else{
                    try {
                        await this.instanceAxios.post(`catalog/products/${id}/variants`, data);
                        console.log(`Done Import Variation with sku: ${data.sku}`)
                    } catch (error) {
                        console.log(error);
                        throw error;
                    }
                }
            }))
            start += 20;
            await this.a();

        }
    };


    async importVariantOption(id, bestbuyProduct) {
        let optionName = new Set();
        let optionValue;
        let options = []

        await Promise.all(
            bestbuyProduct.options.map(async (e) => {
                optionName.add(e.name);
            }));

        await Promise.all(Array.from(optionName).map(async name => {
            let tempValues = [];
            await Promise.all(
                bestbuyProduct.variants.map(async (e) => {
                    for (const [key, value] of Object.entries(e)) {
                        if(key == name.toLowerCase()){
                            tempValues.push(value)
                        }
                    }
                }))

            optionValue = await this.findDuplicates(tempValues);
            const optionValues = []

            await Promise.all(
                Array.from(optionValue).map(e => {
                    optionValues.push({
                        label: e,
                        sort_order: 0,
                    })
                }))
            options.push({
                name: name,
                value: optionValues
            })
        }))

        const optionOnProduct = await this.instanceAxios.get(`catalog/products/${id}/options`);

        await Promise.all(
            options.map(async e => {
                let optionId = this.checkOptionExist(e.name, optionOnProduct.data);

                if(optionId !== false){
                    try {
                        await this.instanceAxios.delete(`catalog/products/${id}/options/${optionId}`);
                    } catch (error) {
                        console.log(error.response.data)
                    }
                }

                try {
                    const a = await this.instanceAxios.post(`catalog/products/${id}/options`, {
                        product_id: id,
                        type: 'radio_buttons',
                        display_name: e.name,
                        option_values: e.value
                    });
                } catch (error) {
                    console.log(error.response.data)
                }
            })
        )
    }

    convertWeight (weight) {
        return weight * 0.453592;
    }

    async findDuplicates(optionValue) {
        const arr = []
        optionValue.map((e, i) => {
            arr.push(e.toLocaleLowerCase());
        });

        const indexDuplicated = [];
        arr.filter((item, index) => {
            if (arr.indexOf(item) !== index) {
                indexDuplicated.push(index);
            }
            return arr.indexOf(item) !== index;
        });
        const temp = []
        optionValue.map((e, i) => {
            if (!indexDuplicated.includes(i)) {
                temp.push(e);
            }
        });

        return temp
    }

    async importOptionValues(options, variation, product) {
    let vari = [];
    for (const [key, value] of Object.entries(variation)) {
        //List option where that match with the variation on product
        const temp = await options.filter(o => { return o.display_name.toLowerCase() == key.toLowerCase() });
        //get the id of option value by filter option_value of option before
        if(temp[0]){
            const tempOption = await temp[0].option_values.filter(o => { return o.label.toLowerCase() == value.toLowerCase() })
            vari.push({
                option_id: temp[0].id,
                id: tempOption[0].id,
                label: product.name,
                option_display_name: product.name,
            })
        }
    }

    return vari

}

}


// Call start
// (async() => {
//     console.log('before start');
//     let bigCommerceClass = new bigCommerceImport();
//     await bigCommerceClass.importData();
//     console.log('after start');
// })();

module.exports = bigCommerceImport;

