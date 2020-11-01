/**
 * @param {Object}              [query={}]
 * @param {Object}              [options={}]
 * @param {Object|String}       [options.select='']
 * @param {Object|String}       [options.projection={}]
 * @param {Object}              [options.options={}]
 * @param {Object|String}       [options.sort]
 * @param {Object|String}       [options.customLabels]
 * @param {Object}              [options.collation]
 * @param {Array|Object|String} [options.populate]
 * @param {Boolean}             [options.lean=false]
 * @param {Boolean}             [options.leanWithId=true]
 * @param {Number}              [options.offset=0] - Use offset or page to set skip position
 * @param {Number}              [options.page=1]
 * @param {Number}              [options.limit=10]
 * @param {Boolean}             [options.estimatedDocumentCount=true] - Enable estimatedDocumentCount use for countPromise evaluation
 * @param {Object}              [options.read={}] - Determines the MongoDB nodes from which to read.
 * @param {Function}            [callback]
 *
 * @returns {Promise}
 */

const defaultOptions = {
  customLabels: {
    totalDocs: 'totalDocs',
    limit: 'limit',
    page: 'page',
    totalPages: 'totalPages',
    docs: 'docs',
    nextPage: 'nextPage',
    prevPage: 'prevPage',
    pagingCounter: 'pagingCounter',
    hasPrevPage: 'hasPrevPage',
    hasNextPage: 'hasNextPage',
    meta: null,
  },
  collation: {},
  lean: false,
  leanWithId: true,
  limit: 10,
  projection: {},
  select: '',
  options: {},
  pagination: true,
  estimatedDocumentCount: true,
  forceCountFn: false
};

function paginate(query, options, callback) {
  options = {
    ...defaultOptions,
    ...paginate.options,
    ...options
  };
  query = query || {};

  const {
    collation,
    lean,
    leanWithId,
    populate,
    projection,
    read,
    select,
    sort,
    pagination,
    estimatedDocumentCount,
    forceCountFn
  } = options;

  const customLabels = {
    ...defaultOptions.customLabels,
    ...options.customLabels
  };

  const limit = parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 0;

  const isCallbackSpecified = typeof callback === 'function';
  const findOptions = options.options;

  let offset;
  let page;
  let skip;

  let docsPromise = [];

  // Labels
  const labelDocs = customLabels.docs;
  const labelLimit = customLabels.limit;
  const labelNextPage = customLabels.nextPage;
  const labelPage = customLabels.page;
  const labelPagingCounter = customLabels.pagingCounter;
  const labelPrevPage = customLabels.prevPage;
  const labelTotal = customLabels.totalDocs;
  const labelTotalPages = customLabels.totalPages;
  const labelHasPrevPage = customLabels.hasPrevPage;
  const labelHasNextPage = customLabels.hasNextPage;
  const labelMeta = customLabels.meta;

  if (options.hasOwnProperty('offset')) {
    offset = parseInt(options.offset, 10);
    skip = offset;
  } else if (options.hasOwnProperty('page')) {
    page = parseInt(options.page, 10);
    skip = (page - 1) * limit;
  } else {
    offset = 0;
    page = 1;
    skip = offset;
  }

  let countPromise;

  if (forceCountFn === true) {
    // Deprecated since starting from MongoDB Node.JS driver v3.1 
    countPromise = this.count(query).exec();
  } else if (estimatedDocumentCount === true) {
    countPromise = this.estimatedDocumentCount(query).exec()
  } else{
    countPromise = this.countDocuments(query).exec();
  }

  if (limit) {
    const mQuery = this.find(query, projection, findOptions);
    mQuery.select(select);
    mQuery.sort(sort);
    mQuery.lean(lean);

    if (read && read.pref) {
      /**
       * Determines the MongoDB nodes from which to read.
       * @param read.pref one of the listed preference options or aliases
       * @param read.tags optional tags for this query
       */
      mQuery.read(read.pref, read.tags);
    }

    // Hack for mongo < v3.4
    if (Object.keys(collation).length > 0) {
      mQuery.collation(collation);
    }

    if (populate) {
      mQuery.populate(populate);
    }

    if (pagination) {
      mQuery.skip(skip);
      mQuery.limit(limit);
    }

    docsPromise = mQuery.exec();

    if (lean && leanWithId) {
      docsPromise = docsPromise.then((docs) => {
        docs.forEach((doc) => {
          doc.id = String(doc._id);
        });
        return docs;
      });
    }

  }

  return Promise.all([countPromise, docsPromise])
    .then((values) => {

      const [count, docs] = values;
      const meta = {
        [labelTotal]: count
      };

      let result = {};

      if (typeof offset !== 'undefined') {
        meta.offset = offset;
        page = Math.ceil((offset + 1) / limit);
      }

      const pages = (limit > 0) ? (Math.ceil(count / limit) || 1) : null;

      // Setting default values
      meta[labelLimit] = count;
      meta[labelTotalPages] = 1;
      meta[labelPage] = page;
      meta[labelPagingCounter] = ((page - 1) * limit) + 1;

      meta[labelHasPrevPage] = false;
      meta[labelHasNextPage] = false;
      meta[labelPrevPage] = null;
      meta[labelNextPage] = null;

      if (pagination) {

        meta[labelLimit] = limit;
        meta[labelTotalPages] = pages;

        // Set prev page
        if (page > 1) {
          meta[labelHasPrevPage] = true;
          meta[labelPrevPage] = (page - 1);
        } else if (page == 1 && typeof offset !== 'undefined' && offset !== 0) {
          meta[labelHasPrevPage] = true;
          meta[labelPrevPage] = 1;
        } else {
          meta[labelPrevPage] = null;
        }

        // Set next page
        if (page < pages) {
          meta[labelHasNextPage] = true;
          meta[labelNextPage] = (page + 1);
        } else {
          meta[labelNextPage] = null;
        }

      }

      // Remove customLabels set to false
      delete meta['false'];

      if (limit == 0) {
        meta[labelLimit] = 0;
        meta[labelTotalPages] = null;
        meta[labelPage] = null;
        meta[labelPagingCounter] = null;
        meta[labelPrevPage] = null;
        meta[labelNextPage] = null;
        meta[labelHasPrevPage] = false;
        meta[labelHasNextPage] = false;
      }

      if (labelMeta) {
        result = {
          [labelDocs]: docs,
          [labelMeta]: meta
        };
      } else {
        result = {
          [labelDocs]: docs,
          ...meta
        };
      }

      return isCallbackSpecified ? callback(null, result) : Promise.resolve(result);
    }).catch((error) => {
      return isCallbackSpecified ? callback(error) : Promise.reject(error);
    });
}

/**
 * @param {Schema} schema
 */
module.exports = (schema) => {
  schema.statics.paginate = paginate;
};

module.exports.paginate = paginate;
