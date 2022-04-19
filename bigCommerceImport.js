const lodash = require("lodash");
const fs = require('fs')
const axios = require("axios");
const { isObject, isArray } = require('lodash');

const bigCommerceKey = "hk9eg6jqxb";
const bigCommerceDomain = `https://api.bigcommerce.com/stores/${bigCommerceKey}/v3`;
//create axios with authorization on BigCommerce
const instanceAxios = axios.create({
    baseURL: bigCommerceDomain,
    headers: {
        "X-Auth-Token": "738kl54y7swkyepcszqy121pne6d1xe",
        "User-Agent": "PostmanRuntime/7.29.0",
        "Accept": "*/*"
    },
});
//
let countCreate, countUpdate;

//Write log
const writeFile = (string) => {
    fs.appendFileSync(`log/ImportProductLog1.txt`, string, err => {
        if (err) {
            console.error(err)
        }
    })
}


//Get product by sku in BC (only product)
const getProductBySkuBC = async (sku) => {
    const res = await instanceAxios.get(`catalog/products?sku=${sku}`);
    return res.data.data.length !== 0 ? res.data.data[0] : null;
};


//Get variant by sku in BC (product and variant cause product without variations will be count a variant)
const getProductVariantBySkuBC = async (sku) => {
    const res = await instanceAxios.get(`catalog/variants?sku=${sku}`);

    return res.data.data.length !== 0 ? res.data.data[0] : null;
};


//import category
const importCategory = async (product) => {
    const categories = []
    await Promise.all(product.categories.map(async e => {
        let name = e.name.replace(/\&/g, '%26')
        //Because BestBuy only provide name of category so need to search category name
        const res = await instanceAxios.get(`catalog/categories?name=${name}`);
        //If no category found start create new category
        if (res.data.data.length == 0) {
            try {
                const category = await instanceAxios.post(`catalog/categories`, {
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
const formatSize = (string) => {
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
const importData = async () => {
    countCreate = 0;
    countUpdate = 0;
    
    //read data
    let jsonPath = "./json/";
    fs.readdir("./json/", (err, files) => {
        files.forEach(async(file, i) => {
            // if(i>0) return;
            if(file.indexOf(".json") > -1){
                let index = 0;
                let jsonData = JSON.parse(fs.readFileSync(jsonPath + file))
                writeFile(`${Date.now()} \n`);
                if(lodash.isObject(jsonData)){
                    console.log("Import");
                    writeFile(file + `\n`);
                    await importProductToBigCommerce(jsonData, 0);
                }else if(lodash.isArray(jsonData)){
                    //Read 20 product pertime to increase performance 
                    const count = Math.ceil(jsonData.length / 20);
                    //read from index * 20 to  index * 20 + 20 and continue to the end of file
                    console.log(index, count);
                    while (index < count) {
                        writeFile(file + `Page : ${index}\n`);
                        const products = jsonData.slice(index * 20, index * 20 + 20);
                        // //With response start import each product
                        products.forEach(async (product, i) => {
                            await importProductToBigCommerce(product, i);
                        });
                        writeFile(`--------------\n`);
                        index++;
                    }
                }
                
            }
        });
    });

    return {
        countCreate: countCreate,
        countUpdate: countUpdate,
    };
};

const importProductToBigCommerce = async (product, index) => {
    writeFile(`index:${index}\n`)
    writeFile(`Before create product with sku : ${product.sku}\n`)
    console.log("Before create product " + product.sku);
    //check with this sku has any variant found
    if (await getProductVariantBySkuBC(product.sku)) {
        console.log(`Import product but had existed like variation with sku ${product.sku}\n`)
        writeFile(`Import product but had existed like variation with sku ${product.sku}\n -------------------------\n`)
        return;
    };
    //check with this sku has any product found 
    if (await getProductBySkuBC(product.sku)) {
        console.log(`Import product but had existed product like variation with sku ${product.sku}\n`)
        writeFile(`Import product but had existed product like variation with sku ${product.sku}\n -------------------------\n`)
        return;
    }
    const data = {
        name: product.name,
        sku: product.sku.toString(),
        type: "physical",
        description: product.description || "",
        weight: convertWeight(product.weight) || 0,
        width: formatSize(product.width) || undefined,
        depth: formatSize(product.depth) || undefined,
        height: formatSize(product.height) || undefined,
        price: getPriceProductBB(product.price || 0, product.weight || product.shippingWeight || 0),
        cost_price: getPriceProductBB(product.cost || 0, product.weight || product.shippingWeight || 0),
        // sale_price: getPriceProductBB(product.cost || product.regularPrice, product.weight || product.shippingWeight),
        // map_price: getPriceProductBB(product.salePrice || product.regularPrice, product.weight || product.shippingWeight),
        // reviews_rating_sum: Number(product.customerReviewAverage * 10),
        // reviews_count: product.customerReviewCount || 0,
        categories: await importCategory(product),
        brand_name: product.vendor ? product.vendor : 'Uncategorized',
        is_visible: true,
        availability: product.published ? "available" : "disabled",
        //If has variation inventory tracking will be variant,
        inventory_tracking: product.variants.length == 0 ? "product" : "variant",
        inventory_level: product.variants.length == 0 ? 100 : undefined,
        //Import images but now not use because conflict size of image 
        images: await importImagesToBigCommerce(product),
        //import custom field
        custom_fields: await importCustomFieldToBigCommerce(product),
    };



    let BCproduct
    try {
        BCproduct = await instanceAxios.post(`catalog/products`, data);
    } catch (err) {
        //If Name is duplicate will add extra sku to name and create again
        if (err.response && err.response.data.title == "The product name is a duplicate") {
            data.name = product.name + " " + product.sku
            BCproduct = await instanceAxios.post(`catalog/products`, data);
            writeFile(`done create product with sku : ${product.sku}\n`)
        } else {
            writeFile(`done create product with sku : ${product.sku}\n`)
            console.log(err);
            throw err
        }
    }
    //add variation
    await importVariantOnProduct(BCproduct.data.data.id, product, data.categories);
    countCreate++;
    console.log("Create successfuly");
    writeFile("Create successfuly \n  --------------------- \n")

    console.log("index: " + (countCreate + countUpdate));
    //wait 1 second
    await a();
    return;
};

//Calculate the price 
const getPriceProductBB = (price, weight) => {
    let margin = 0;
    const isUnder = price <= 100;
    let isHeavy = false;

    switch (true) {
        case price <= 100:
            margin = 1.28;
            break;
        case price <= 500:
            margin = 1.26;
            break;
        case price <= 1000:
            margin = 1.15;
            break;
        case price <= 1500:
            margin = 1.1;
            break;
        case price <= 2000:
            margin = 1.05;
            break;
        case price <= 2500:
            margin = 1.03;
            break;
        default:
            margin = 1.02;
            break;
    }

    price *= margin;

    if (weight) {
        const lbsProduct = parseInt(weight);
        isHeavy = lbsProduct > 71;
    }

    return isHeavy ? (price + 149) : price;
}


//Not use anymore
const importImagesToBigCommerce = async (product) => {
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
                writeFile(`${url} Has failed\n`);
            }
        })
    );

    return images;
};


//By the name of method
const importCustomFieldToBigCommerce = async (product) => {
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
};

const a = async () => {
    return new Promise(resolve => setTimeout(resolve, 1000));
}


const importVariantOnProduct = async (id, product, categories) => {
    writeFile("Create Variation on products\n")
    //If dont have any vartiation return
    if (product.variants.length == 0) {
        writeFile("Dont have variation on this products\n")
        return;
    }

    //Create product option to product 
    await importVariantOption(id, product)

    //Get product option created before
    const optionOnProduct = await instanceAxios.get(`catalog/products/${id}/options`);
    console.log(`catalog/products/${id}/options`);
    //To avoid exceed request on BestBuy, process each time 20 variation, co
    let count = Math.ceil(product.variants.length / 20);
    let start = 0;
    for (let i = 0; i < count; i++) {
        //process create 20 variation one time
        await Promise.all(product.variants.slice(start, start + 20).map(async e => {
            //variation had existed
            if (await getProductVariantBySkuBC(e.sku)) {
                console.log(`Import variation but had existed like variation with sku ${e.sku}\n`)
                writeFile(`Import variation but had existed like variation with sku ${e.sku}\n -------------------------\n`)
                return;
            };

            //If  variation with this sku is not existed anymore do nothing
            const data = {
                    name: product.name,
                    sku: e.sku.toString(),
                    type: "physical",
                    description: product.description,
                    weight: convertWeight(e.weight) || 0,
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
                    custom_fields: await importCustomFieldToBigCommerce(product),
                    option_values: await importOptionValues(optionOnProduct.data.data, e, product)
            };
            //  console.log(await getProductBySkuBC(productBB.sku));
            //I see some variation on a product dont have option so cant import that sku 
            try {
                writeFile(`Import Variation with sku: ${data.sku}\n`)
                await instanceAxios.post(`catalog/products/${id}/variants`, data);
                writeFile(`Done Import Variation with sku: ${data.sku}\n`)
                console.log(`Done Import Variation with sku: ${data.sku}`)
            } catch (error) {
                throw error
            }
        }))
        start += 20;
        await a();

    }
    return;
};


const importVariantOption = async (id, bestbuyProduct) => {
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

        optionValue = await findDuplicates(tempValues);
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

    await Promise.all(
        options.map(async e => {
            try {
                const a = await instanceAxios.post(`catalog/products/${id}/options`, {
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

    return;
};

const convertWeight = (weight) => {
    return weight * 0.453592;
}

const findDuplicates = async (optionValue) => {
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



const importOptionValues = async (options, variation, product) => {
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



// Call start
(async() => {
    console.log('before start');
    await importData();
    console.log('after start');
})();

